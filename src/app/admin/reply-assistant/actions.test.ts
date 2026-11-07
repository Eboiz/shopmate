import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineInput, EngineOutput } from "@/contract";

const SHOP = "a0000000-0000-4000-8000-000000000001";

const requireStaff = vi.fn();
vi.mock("@/lib/auth", () => ({ requireStaff: () => requireStaff() }));

const runStaffDraft = vi.fn<(input: EngineInput) => Promise<EngineOutput>>();
vi.mock("@/lib/engine/run", () => ({ runStaffDraft: (input: EngineInput) => runStaffDraft(input) }));

const limitReached = vi.fn<(shopId: string) => Promise<boolean>>();
vi.mock("@/lib/guard/staff-draft-limit", () => ({ staffDraftLimitReached: (shopId: string) => limitReached(shopId) }));

const { generateStaffDraft } = await import("./actions");

const draft: EngineOutput = {
  reply: { text: "Dạ váy còn size M ạ", products: [], quickReplies: [] },
  personalReplyNeeded: false,
};

beforeEach(() => {
  requireStaff.mockReset().mockResolvedValue({ userId: "u1", shopId: SHOP, role: "staff" });
  runStaffDraft.mockReset().mockResolvedValue(draft);
  limitReached.mockReset().mockResolvedValue(false);
});

describe("generateStaffDraft (PB-20)", () => {
  it("runs the engine in staff_draft mode with the question as the shopper's message", async () => {
    expect(await generateStaffDraft("  Váy còn size M không?  ")).toEqual(draft);
    expect(runStaffDraft).toHaveBeenCalledWith({
      mode: "staff_draft",
      history: [{ sender: "shopper", text: "Váy còn size M không?" }],
    });
    // No shop in the engine input: runStaffDraft takes it from the profile.
    expect(runStaffDraft.mock.calls[0][0]).not.toHaveProperty("shopId");
    expect(limitReached).toHaveBeenCalledWith(SHOP);
  });

  it("returns personalReplyNeeded from the engine for a complaint", async () => {
    const personal: EngineOutput = { reply: { text: "x", products: [], quickReplies: [] }, personalReplyNeeded: true };
    runStaffDraft.mockResolvedValue(personal);
    expect(await generateStaffDraft("Áo bị rách, mình muốn khiếu nại")).toEqual(personal);
  });

  it("rejects a caller who is not signed in before any engine call", async () => {
    requireStaff.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(generateStaffDraft("Váy còn không?")).rejects.toThrow("NEXT_REDIRECT");
    expect(runStaffDraft).not.toHaveBeenCalled();
    expect(limitReached).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty question", "   "],
    ["a question over 1000 characters", "a".repeat(1001)],
    ["a non-string body", 42 as unknown as string],
  ])("rejects %s without calling the engine", async (_name, question) => {
    await expect(generateStaffDraft(question)).rejects.toThrow("invalid_question");
    expect(runStaffDraft).not.toHaveBeenCalled();
  });

  it("stops before the engine when the shop used its draft budget", async () => {
    limitReached.mockResolvedValue(true);
    await expect(generateStaffDraft("Váy còn không?")).rejects.toThrow("draft_limit_reached");
    expect(runStaffDraft).not.toHaveBeenCalled();
  });
});
