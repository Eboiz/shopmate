import { describe, expect, it } from "vitest";
import { hasBlank, type GapQuestion } from "@/contract";
import { scriptedModel } from "@/lib/engine/test/fake-model";
import { analyzeGaps } from "./gaps";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [C1, C2, C3, C4] = [1, 2, 3, 4].map((n) => uuid(100 + n));
const q = (n: number, conversationId: string, question: string): GapQuestion => ({
  id: uuid(n),
  conversationId,
  reason: "policy_not_covered",
  question,
});
const G = [
  q(1, C1, "Shop có cho kiểm hàng không?"),
  q(2, C2, "Nhận hàng được mở ra xem không?"),
  q(3, C3, "Giao trong ngày không?"),
  q(4, C3, "Hôm nay nhận được không?"),
  q(5, C1, "Hàng sale đổi được không?"),
  q(6, C4, "Đồ giảm giá có đổi không?"),
];

type Topic = { title: string; policyKind: string; refs: string[]; draft: string };
const topic = (over: Partial<Topic> = {}): Topic => ({
  title: "Kiểm hàng trước khi nhận",
  policyKind: "giao_hang",
  refs: ["q1", "q2"],
  draft: "Shop [có/không] cho kiểm hàng trước khi nhận.",
  ...over,
});
const text = (t: string) => ({ content: [{ type: "text" as const, text: t, citations: null }] });
const modelSaying = (topics: Topic[]) => scriptedModel([text(JSON.stringify({ topics }))]);

describe("analyzeGaps", () => {
  it("returns no topic for an empty list without calling the model", async () => {
    const model = scriptedModel([]);
    expect(await analyzeGaps([], { model })).toEqual([]);
    expect(model.calls.length).toBe(0);
  });

  it("groups by refs and maps back to ids", async () => {
    const model = modelSaying([topic()]);
    const [t] = await analyzeGaps(G, { model });
    expect(t.questionIds).toEqual([G[0].id, G[1].id]);
    expect(t.conversationCount).toBe(2);
    expect(t.sampleQuestions).toEqual([G[0].question, G[1].question]);
    const sent = JSON.stringify(model.calls[0].messages);
    expect(sent).not.toContain(G[0].id);
    expect(model.calls[0].tools).toBeUndefined();
    expect(model.calls[0].output_config?.format?.type).toBe("json_schema");
  });

  it("drops a topic from fewer than 2 conversations", async () => {
    const out = await analyzeGaps(G, { model: modelSaying([topic({ refs: ["q3", "q4"] })]) });
    expect(out).toEqual([]);
  });

  it("drops unknown refs and refs already in an earlier topic", async () => {
    const out = await analyzeGaps(G, {
      model: modelSaying([topic({ refs: ["q1", "q2", "q99"] }), topic({ title: "Đổi hàng sale", refs: ["q2", "q5", "q6"] })]),
    });
    expect(out[0].questionIds).toEqual([G[0].id, G[1].id]);
    expect(out[1].questionIds).toEqual([G[4].id, G[5].id]);
  });

  it("replaces a draft that states facts", async () => {
    const [t] = await analyzeGaps(G, { model: modelSaying([topic({ draft: "Shop giảm 50% cho mọi đơn." })]) });
    expect(hasBlank(t.draft)).toBe(true);
    expect(t.draft).not.toContain("50");
  });

  it("keeps a draft whose facts are blanks", async () => {
    const [t] = await analyzeGaps(G, { model: modelSaying([topic()]) });
    expect(t.draft).toBe("Shop [có/không] cho kiểm hàng trước khi nhận.");
  });

  it("strips numbers from the title", async () => {
    const [t] = await analyzeGaps(G, { model: modelSaying([topic({ title: "Giảm 50% mọi đơn" })]) });
    expect(t.title).not.toMatch(/\d/);
    expect(t.title.length).toBeGreaterThan(0);
  });

  it("sorts by conversationCount and keeps at most 3 samples", async () => {
    const many = [...G, q(7, C3, "Kiểm hàng được chứ?"), q(8, C4, "Cho xem hàng trước không?")];
    const out = await analyzeGaps(many, {
      model: modelSaying([topic({ title: "Đổi hàng sale", refs: ["q5", "q6"] }), topic({ refs: ["q1", "q2", "q7", "q8"] })]),
    });
    expect(out.map((t) => t.conversationCount)).toEqual([4, 2]);
    expect(out[0].sampleQuestions).toHaveLength(3);
  });

  it("throws on output it can't read", async () => {
    await expect(analyzeGaps(G, { model: scriptedModel([text("{}")]) })).rejects.toThrow("analyzeGaps");
  });
});
