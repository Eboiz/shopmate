import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GapTopicProposal } from "@/contract";
import { NOT_ALLOWED } from "@/lib/catalog-write-errors";

const SHOP = "a0000000-0000-4000-8000-000000000001";
const OWNER = "a0000000-0000-4000-8000-000000000070";
const OTHER_SHOP = "b0000000-0000-4000-8000-000000000001";
const FACT = "a0000000-0000-4000-8000-000000000081";
const GAP1 = "a0000000-0000-4000-8000-000000000091";
const GAP2 = "a0000000-0000-4000-8000-000000000092";
const GAP3 = "a0000000-0000-4000-8000-000000000093";
const GAP4 = "a0000000-0000-4000-8000-000000000094";
const CONV = "a0000000-0000-4000-8000-000000000031";

const requireStaff = vi.fn();
vi.mock("@/lib/auth", () => ({ requireStaff: () => requireStaff() }));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

// The RLS client: decide functions get it as is; draftTopics reads data_gaps from it.
let gapRows: { id: string; conversation_id: string; reason: string; question: string; status: string }[];
let gapFilters: [string, unknown][];
const rlsDb = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => (gapFilters.push([key, value]), chain),
      in: (key: string, value: unknown) => (gapFilters.push([key, value]), chain),
      is: (key: string, value: unknown) => (gapFilters.push([key, value]), chain),
      gte: () => chain,
      order: async () => ({ data: gapRows, error: null }),
    };
    return chain;
  },
};
const createClient = vi.fn(async () => rlsDb);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => "admin-db" }));

const decide = {
  removeFact: vi.fn(),
  approveFact: vi.fn(),
  editFact: vi.fn(),
  setLearningMode: vi.fn(),
  dismissGaps: vi.fn(),
  insertFromDraft: vi.fn(),
};
vi.mock("@/lib/learning/decide", () => decide);

const analyzeGaps = vi.fn();
vi.mock("@/lib/learning", () => ({ analyzeGaps: (...args: unknown[]) => analyzeGaps(...args) }));
vi.mock("@/lib/engine/anthropic-model", () => ({ createDefaultModel: () => "model" }));

const actions = await import("./actions");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const NONE = { error: null };
const writes = [
  ["removeLearned", actions.removeLearned, { factId: FACT }],
  ["approveLearned", actions.approveLearned, { factId: FACT }],
  ["editLearned", actions.editLearned, { factId: FACT, text: "Shop cho kiểm hàng trước khi nhận." }],
  ["changeLearningMode", actions.changeLearningMode, { mode: "review" }],
  ["dismissQuestions", actions.dismissQuestions, { gapIds: GAP1 }],
  ["approveTopic", actions.approveTopic, { gapIds: GAP1, policyKind: "giao_hang", text: "Shop cho kiểm hàng." }],
] as const;

const asOwner = () => requireStaff.mockResolvedValue({ userId: OWNER, shopId: SHOP, role: "owner" });

beforeEach(() => {
  requireStaff.mockReset().mockResolvedValue({ userId: OWNER, shopId: SHOP, role: "staff" });
  refresh.mockReset();
  createClient.mockClear();
  for (const fn of Object.values(decide)) fn.mockReset();
  decide.removeFact.mockResolvedValue(true);
  decide.approveFact.mockResolvedValue(true);
  decide.editFact.mockResolvedValue(true);
  decide.setLearningMode.mockResolvedValue(true);
  decide.dismissGaps.mockResolvedValue(1);
  decide.insertFromDraft.mockResolvedValue("ok");
  analyzeGaps.mockReset();
  gapRows = [];
  gapFilters = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("staff (PB-35a)", () => {
  it.each(writes)("%s is refused without touching the database", async (_name, action, values) => {
    const state = await action(NONE, form(values));
    expect(state.error).toBe(NOT_ALLOWED);
    expect(createClient).not.toHaveBeenCalled();
    for (const fn of Object.values(decide)) expect(fn).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("can't run Soạn câu trả lời, and the model is never called", async () => {
    expect(await actions.draftTopics()).toEqual({ ok: false, error: NOT_ALLOWED });
    expect(createClient).not.toHaveBeenCalled();
    expect(analyzeGaps).not.toHaveBeenCalled();
  });
});

describe("owner decisions", () => {
  beforeEach(asOwner);

  it("passes the RLS client and the session's shop and user, never the form's", async () => {
    const extra = { shopId: OTHER_SHOP, userId: CONV };
    await actions.removeLearned(NONE, form({ factId: FACT, ...extra }));
    expect(decide.removeFact).toHaveBeenCalledWith(rlsDb, { shopId: SHOP, factId: FACT, userId: OWNER });
    await actions.approveLearned(NONE, form({ factId: FACT, ...extra }));
    expect(decide.approveFact).toHaveBeenCalledWith(rlsDb, { shopId: SHOP, factId: FACT, userId: OWNER });
    await actions.editLearned(NONE, form({ factId: FACT, text: "  Có kiểm hàng.  ", ...extra }));
    expect(decide.editFact).toHaveBeenCalledWith(rlsDb, { shopId: SHOP, factId: FACT, userId: OWNER, text: "Có kiểm hàng." });
    await actions.changeLearningMode(NONE, form({ mode: "review", ...extra }));
    expect(decide.setLearningMode).toHaveBeenCalledWith(rlsDb, SHOP, "review");
    await actions.dismissQuestions(NONE, form({ gapIds: `${GAP1},${GAP2}`, ...extra }));
    expect(decide.dismissGaps).toHaveBeenCalledWith(rlsDb, SHOP, [GAP1, GAP2]);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it("approves a topic with the secret-key client and the session's owner", async () => {
    const state = await actions.approveTopic(NONE, form({ gapIds: `${GAP1},${GAP2}`, policyKind: "giao_hang", text: " Shop cho kiểm hàng. ", shopId: OTHER_SHOP }));
    expect(state).toEqual({ error: null });
    expect(decide.insertFromDraft).toHaveBeenCalledWith("admin-db", {
      shopId: SHOP, userId: OWNER, gapIds: [GAP1, GAP2], policyKind: "giao_hang", text: "Shop cho kiểm hàng.",
    });
  });

  it("refuses a topic whose draft still has a blank", async () => {
    decide.insertFromDraft.mockResolvedValue("blank");
    const state = await actions.approveTopic(NONE, form({ gapIds: GAP1, policyKind: "giao_hang", text: "Shop [có/không] cho kiểm hàng." }));
    expect(state.error).toMatch(/chỗ trống/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects bad input before reading the session", async () => {
    expect((await actions.editLearned(NONE, form({ factId: FACT, text: "   " }))).error).toBeTruthy();
    expect((await actions.editLearned(NONE, form({ factId: FACT, text: "x".repeat(501) }))).error).toBeTruthy();
    expect((await actions.removeLearned(NONE, form({ factId: "not-an-id" }))).error).toBeTruthy();
    expect((await actions.dismissQuestions(NONE, form({ gapIds: `${GAP1},nope` }))).error).toBeTruthy();
    expect(requireStaff).not.toHaveBeenCalled();
  });

  it("says not found when no row changed, and keeps the typed text", async () => {
    decide.editFact.mockResolvedValue(false);
    const state = await actions.editLearned(NONE, form({ factId: FACT, text: "Có kiểm hàng." }));
    expect(state).toEqual({ error: "Không tìm thấy dữ liệu, hãy tải lại trang.", values: { factId: FACT, text: "Có kiểm hàng." } });
  });

  it("turns a database error into a retry message", async () => {
    decide.removeFact.mockRejectedValue(new Error("learned_facts: boom"));
    expect((await actions.removeLearned(NONE, form({ factId: FACT }))).error).toBe("Lưu không được, hãy thử lại.");
  });
});

describe("draftTopics (Soạn câu trả lời)", () => {
  beforeEach(asOwner);

  const gap = (id: string, status: string) => ({ id, conversation_id: CONV, reason: "policy_not_covered", question: `Hỏi ${id}`, status });
  const proposal = (questionIds: string[], title = "Kiểm hàng"): GapTopicProposal => ({
    title, policyKind: "giao_hang", questionIds, conversationCount: 2, sampleQuestions: ["Cho kiểm hàng không?"], draft: "Shop [có/không] cho kiểm hàng.",
  });

  it("sends open and learned questions of this shop to the model and keeps topics with an open one", async () => {
    gapRows = [gap(GAP1, "open"), gap(GAP2, "learned"), gap(GAP3, "learned"), gap(GAP4, "open")];
    analyzeGaps.mockResolvedValue([proposal([GAP1, GAP2]), proposal([GAP2, GAP3], "Đã học hết"), proposal([GAP4, GAP1], "Mới")]);

    const result = await actions.draftTopics();

    expect(gapFilters).toContainEqual(["shop_id", SHOP]);
    expect(gapFilters).toContainEqual(["status", ["open", "learned"]]);
    expect(gapFilters).toContainEqual(["reason", ["policy_not_covered", "not_covered_by_data"]]);
    expect(gapFilters).toContainEqual(["product_id", null]);
    expect(analyzeGaps).toHaveBeenCalledWith(
      gapRows.map((g) => ({ id: g.id, conversationId: CONV, reason: "policy_not_covered", question: g.question })),
      { model: "model" },
    );
    expect(result).toEqual({
      ok: true,
      topics: [
        { title: "Kiểm hàng", policyKind: "giao_hang", openIds: [GAP1], conversationCount: 2, sampleQuestions: ["Cho kiểm hàng không?"], draft: "Shop [có/không] cho kiểm hàng.", askedAgain: true },
        { title: "Mới", policyKind: "giao_hang", openIds: [GAP4, GAP1], conversationCount: 2, sampleQuestions: ["Cho kiểm hàng không?"], draft: "Shop [có/không] cho kiểm hàng.", askedAgain: false },
      ],
    });
  });

  it("skips the model when no question is open", async () => {
    gapRows = [gap(GAP2, "learned")];
    expect(await actions.draftTopics()).toEqual({ ok: true, topics: [] });
    expect(analyzeGaps).not.toHaveBeenCalled();
  });

  it("returns a retry message when the model fails", async () => {
    gapRows = [gap(GAP1, "open")];
    analyzeGaps.mockRejectedValue(new Error("analyzeGaps: invalid model output"));
    expect(await actions.draftTopics()).toEqual({ ok: false, error: "Chưa soạn được, thử lại" });
  });
});
