import { describe, expect, it } from "vitest";
import type { LearnInput } from "@/contract";
import type { ModelClient } from "@/lib/engine/engine";
import { scriptedModel } from "@/lib/engine/test/fake-model";
import { learnFromStaffReply } from "./learn";
import { LEARNING_PROMPT_VERSION } from "./prompt";

const POLICIES: LearnInput["policies"] = [
  { kind: "doi_tra", content: "Đổi trong 7 ngày" },
  { kind: "giao_hang", content: null },
  { kind: "khuyen_mai", content: null },
];

const input = (over: Partial<LearnInput> = {}): LearnInput => ({
  question: "Shop có cho kiểm hàng không?",
  staffReply: "Dạ shop có cho kiểm hàng trước khi nhận ạ",
  policies: POLICIES,
  ...over,
});

const output = (over: Record<string, unknown> = {}) => ({
  kind: "general",
  policyKind: "giao_hang",
  rule: "Shop cho khách kiểm hàng trước khi nhận.",
  evidence: "shop có cho kiểm hàng trước khi nhận",
  conflictsWithPolicy: false,
  vague: false,
  needsReview: false,
  reason: "",
  ...over,
});

const text = (t: string) => ({ content: [{ type: "text" as const, text: t, citations: null }] });
const modelSaying = (out: unknown) => scriptedModel([text(JSON.stringify(out))]);

describe("learnFromStaffReply", () => {
  it("learns one general rule", async () => {
    const model = modelSaying(output());
    const result = await learnFromStaffReply(input(), { model });
    expect(result).toMatchObject({ status: "learn", policyKind: "giao_hang", needsReview: false, reviewReasons: [] });
    const call = model.calls[0];
    expect(call.tools).toBeUndefined();
    expect(call.output_config?.format?.type).toBe("json_schema");
    expect(JSON.stringify(call.system)).toContain(LEARNING_PROMPT_VERSION);
  });

  it("skips a rule the model marks one_off", async () => {
    const result = await learnFromStaffReply(input(), { model: modelSaying(output({ kind: "one_off" })) });
    expect(result).toMatchObject({ status: "skip", skipReason: "one_off" });
  });

  it("skips a one-off staff reply even when the model says general", async () => {
    const staffReply = "Dạ lần này shop bớt riêng chị 50k ạ";
    const out = output({ rule: "Shop bớt 50k.", evidence: "shop bớt riêng chị 50k" });
    const result = await learnFromStaffReply(input({ staffReply }), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "skip", skipReason: "one_off" });
  });

  it("skips an empty rule", async () => {
    const result = await learnFromStaffReply(input(), { model: modelSaying(output({ rule: "  " })) });
    expect(result).toMatchObject({ status: "skip", skipReason: "no_rule" });
  });

  it("skips evidence that is not in the staff reply", async () => {
    const out = output({ evidence: "shop miễn phí kiểm hàng" });
    const result = await learnFromStaffReply(input(), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "skip", skipReason: "evidence_not_found" });
  });

  it("skips numbers that are not in the staff reply", async () => {
    const out = output({ policyKind: "doi_tra", rule: "Đổi trong 14 ngày.", evidence: "đổi trong 7 ngày" });
    const result = await learnFromStaffReply(input({ staffReply: "Dạ đổi trong 7 ngày ạ" }), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "skip", skipReason: "number_mismatch" });
  });

  it("needs review for a discount", async () => {
    const staffReply = "Dạ khách mới nhập mã HELLO giảm 10% ạ";
    const out = output({ policyKind: "khuyen_mai", rule: "Khách mới nhập mã HELLO được giảm 10%.", evidence: "khách mới nhập mã HELLO giảm 10%" });
    const result = await learnFromStaffReply(input({ staffReply }), { model: modelSaying(out) });
    expect(result.status).toBe("learn");
    if (result.status !== "learn") return;
    expect(result.needsReview).toBe(true);
    expect(result.reviewReasons).toContain("discount");
  });

  it("needs review for a conflict with the current policy", async () => {
    const result = await learnFromStaffReply(input(), { model: modelSaying(output({ conflictsWithPolicy: true })) });
    expect(result).toMatchObject({ status: "learn", needsReview: true });
    if (result.status === "learn") expect(result.reviewReasons).toContain("conflict");
  });

  it("needs review for a vague staff reply the model missed", async () => {
    const staffReply = "Dạ chắc là có cho kiểm hàng ạ";
    const out = output({ evidence: "có cho kiểm hàng" });
    const result = await learnFromStaffReply(input({ staffReply }), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "learn", needsReview: true });
    if (result.status === "learn") expect(result.reviewReasons).toContain("vague");
  });

  it("needs review when the model asks for it", async () => {
    const result = await learnFromStaffReply(input(), { model: modelSaying(output({ needsReview: true })) });
    expect(result).toMatchObject({ status: "learn", needsReview: true, reviewReasons: ["model"] });
  });

  it("redacts personal info before the number check", async () => {
    const staffReply = "Dạ chị Thảo ơi shop nhận COD toàn quốc, cần gì chị gọi 0912 345 678 nhé";
    const out = output({ rule: "Chị Thảo: shop nhận COD toàn quốc, gọi 0912 345 678.", evidence: "shop nhận COD toàn quốc" });
    const result = await learnFromStaffReply(input({ staffReply, shopperName: "Thảo" }), { model: modelSaying(out) });
    expect(result.status).toBe("learn");
    if (result.status !== "learn") return;
    expect(result.rule).not.toContain("Thảo");
    expect(result.rule).not.toMatch(/\d/);
  });

  it("skips output that is not JSON", async () => {
    const result = await learnFromStaffReply(input(), { model: scriptedModel([text("không phải JSON"), text("không phải JSON")]) });
    expect(result).toMatchObject({ status: "skip", skipReason: "invalid_output" });
  });

  it("lets a model error through", async () => {
    const model: ModelClient = { create: async () => Promise.reject(new Error("boom")) };
    await expect(learnFromStaffReply(input(), { model })).rejects.toThrow("boom");
  });
});

describe("learnFromStaffReply review fixes", () => {
  it("needs review when the rule flips the staff's negation", async () => {
    const staffReply = "Dạ shop không cho kiểm hàng ạ";
    const out = output({ evidence: "shop không cho kiểm hàng" });
    const result = await learnFromStaffReply(input({ staffReply }), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "learn", needsReview: true });
    if (result.status === "learn") expect(result.reviewReasons).toContain("unverified");
  });

  it("needs review when the rule says much the staff didn't", async () => {
    const out = output({ rule: "Shop bán sỉ cho đại lý ở mọi tỉnh thành và cho kiểm hàng." });
    const result = await learnFromStaffReply(input(), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "learn", needsReview: true });
    if (result.status === "learn") expect(result.reviewReasons).toContain("unverified");
  });

  it("needs review for a gift that names staff", async () => {
    const staffReply = "Dạ nhân viên tặng quà cho khách mới ạ";
    const out = output({ policyKind: "khuyen_mai", rule: "Nhân viên tặng quà cho khách mới.", evidence: "nhân viên tặng quà cho khách mới" });
    const result = await learnFromStaffReply(input({ staffReply }), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "learn", needsReview: true });
    if (result.status === "learn") expect(result.reviewReasons).toContain("discount");
  });

  it("removes an honorific and name even without shopperName", async () => {
    const staffReply = "Dạ chị Thảo ơi, shop nhận COD toàn quốc ạ";
    const out = output({ rule: "Shop nhận COD cho chị Thảo trên toàn quốc.", evidence: "shop nhận COD toàn quốc" });
    const result = await learnFromStaffReply(input({ staffReply }), { model: modelSaying(out) });
    expect(result.status).toBe("learn");
    if (result.status === "learn") expect(result.rule).not.toContain("Thảo");
  });

  it("skips a rule too long to keep whole instead of cutting it", async () => {
    const staffReply = `Dạ ${"đổi trong 7 ngày, ".repeat(30)}trừ hàng sale ạ`;
    const rule = `${"Đổi trong 7 ngày, ".repeat(30)}trừ hàng sale.`;
    const out = output({ policyKind: "doi_tra", rule, evidence: "trừ hàng sale" });
    const result = await learnFromStaffReply(input({ staffReply }), { model: modelSaying(out) });
    expect(result).toMatchObject({ status: "skip", skipReason: "too_long" });
  });
});

describe("learnFromStaffReply output handling", () => {
  it("reads JSON wrapped in prose or a code fence", async () => {
    const model = scriptedModel([text("Đây là kết quả:\n```json\n" + JSON.stringify(output()) + "\n```")]);
    expect((await learnFromStaffReply(input(), { model })).status).toBe("learn");
  });

  it("accepts output without a reason", async () => {
    const { reason: _reason, ...noReason } = output();
    void _reason;
    expect((await learnFromStaffReply(input(), { model: modelSaying(noReason) })).status).toBe("learn");
  });

  it("asks once more when the output can't be read", async () => {
    const model = scriptedModel([text(JSON.stringify({ rules: [output()] })), text(JSON.stringify(output()))]);
    const result = await learnFromStaffReply(input(), { model });
    expect(result.status).toBe("learn");
    expect(model.calls).toHaveLength(2);
  });

  it("gives up after the second unreadable output", async () => {
    const model = scriptedModel([text("x"), text("y")]);
    expect(await learnFromStaffReply(input(), { model })).toMatchObject({ status: "skip", skipReason: "invalid_output" });
    expect(model.calls).toHaveLength(2);
  });
});
