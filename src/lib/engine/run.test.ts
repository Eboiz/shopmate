import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineInput } from "@/contract";

const engine = vi.hoisted(() => vi.fn());
const after = vi.hoisted(() => vi.fn());
vi.mock("./engine", () => ({ runEngine: engine }));
const requireStaff = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/auth", () => ({ requireStaff }));

import { runEngine, runStaffDraft } from "./run";

const input: EngineInput = {
  mode: "customer",
  conversationId: "0c1c6e0e-8a0b-4b88-9d6c-0d3b2b0a1f11",
  history: [{ sender: "shopper", text: "Chào" }],
};
const output = { reply: { text: "Dạ chào bạn", products: [], quickReplies: [] }, personalReplyNeeded: false };

describe("runEngine (channel contract)", () => {
  beforeEach(() => {
    engine.mockReset();
    after.mockReset();
  });

  it("resolves with the EngineOutput only and keeps the log write running after the response", async () => {
    const turnLogged = Promise.resolve("row-1");
    engine.mockResolvedValue({ output, handoffReason: null, turnLogged });

    await expect(runEngine(input)).resolves.toEqual(output);
    expect(engine).toHaveBeenCalledWith(input);
    expect(after).toHaveBeenCalledWith(turnLogged);
  });

  it("still returns the reply when after() is unavailable (outside a request)", async () => {
    engine.mockResolvedValue({ output, handoffReason: null, turnLogged: Promise.resolve(null) });
    after.mockImplementation(() => {
      throw new Error("after was called outside a request scope");
    });
    await expect(runEngine(input)).resolves.toEqual(output);
  });

  it("lets engine errors through so the channel can hand over to staff", async () => {
    engine.mockRejectedValue(new Error("boom"));
    await expect(runEngine(input)).rejects.toThrow("boom");
  });

  it("runStaffDraft takes the shop from the signed-in staff member, not from the input", async () => {
    requireStaff.mockResolvedValue({ userId: "u", shopId: "shop-from-profile", role: "staff" });
    const turnLogged = Promise.resolve("row-2");
    engine.mockResolvedValue({ output, handoffReason: null, turnLogged });
    const draft = { mode: "staff_draft" as const, history: [{ sender: "shopper" as const, text: "Còn size M không?" }] };

    await expect(runStaffDraft(draft)).resolves.toEqual(output);
    expect(engine).toHaveBeenCalledWith(draft, { staffShopId: "shop-from-profile" });
    expect(after).toHaveBeenCalledWith(turnLogged);
  });

  it("runStaffDraft does not run the engine when nobody is signed in", async () => {
    requireStaff.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(runStaffDraft({ mode: "staff_draft", history: [{ sender: "shopper", text: "x" }] })).rejects.toThrow("NEXT_REDIRECT");
    expect(engine).not.toHaveBeenCalled();
  });
});
