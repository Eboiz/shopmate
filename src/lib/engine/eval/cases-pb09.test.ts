import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { HANDOFF_TEXT } from "../engine";
import { OFFER_QUESTION, OFFER_QUICK_REPLIES } from "../handoff-offer";
import { toModelMessages } from "../messages";
import { evalCases } from "./cases";
import { pb09Cases } from "./cases-pb09";
import { scoreRun, type ActualCall, type RunOutcome } from "./score";

const byId = (id: string) => pb09Cases.find((c) => c.id === id)!;

// A correct and a wrong run per case, by hand: the labels must accept / reject them.
const correct: Record<string, { calls: ActualCall[]; outcome: RunOutcome }> = {
  "pb09-return-7-days": {
    calls: [{ name: "get_policy", input: { kind: "doi_tra" } }],
    outcome: { handoffReason: null, replyText: "Dạ shop cho đổi trong 7 ngày ạ." },
  },
  // PB-31 soft handoff: the offer's handoff_to_staff call is not logged.
  "pb09-free-ship-not-covered": {
    calls: [{ name: "get_policy", input: { kind: "giao_hang" } }],
    outcome: {
      handoffReason: null,
      handoffOffer: "policy_not_covered",
      replyText: `Dạ shop chưa ghi chính sách phí ship. ${OFFER_QUESTION}`,
      quickReplies: OFFER_QUICK_REPLIES,
    },
  },
  "pb09-discount-ask": {
    calls: [{ name: "get_policy", input: { kind: "khuyen_mai" } }],
    outcome: { handoffReason: null, replyText: "Dạ shop không tự bớt giá được ạ, váy giá 350.000đ một cái." },
  },
  "pb38-hypothetical-wrong-color": {
    calls: [{ name: "get_policy", input: { kind: "doi_tra" } }],
    outcome: {
      handoffReason: null,
      handoffOffer: "policy_not_covered",
      replyText: `Dạ shop cho đổi trong 7 ngày ạ, phí ship đổi và hoàn tiền shop chưa ghi. ${OFFER_QUESTION}`,
      quickReplies: OFFER_QUICK_REPLIES,
    },
  },
};

describe("pb09Cases", () => {
  it("are valid and don't clash with the base cases", () => {
    const ids = new Set(evalCases.map((c) => c.id));
    for (const c of pb09Cases) {
      expect(ids.has(c.id), c.id).toBe(false);
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
    }
  });

  it("accept a correct run", () => {
    for (const c of pb09Cases) {
      const run = correct[c.id];
      expect(run, `no correct run for ${c.id}`).toBeDefined();
      expect(scoreRun(c, run.calls, run.outcome).passed, c.id).toBe(true);
    }
  });

  it("AC1: reject a returns answer with another day count or no 7 days", () => {
    const c = byId("pb09-return-7-days");
    const calls = correct[c.id].calls;
    const wrong = ["Dạ shop cho đổi trong 30 ngày ạ.", "Dạ shop cho đổi trong 7 ngày, hàng lỗi thì 14 ngày ạ.", "Dạ shop có cho đổi ạ."];
    for (const replyText of wrong) expect(scoreRun(c, calls, { handoffReason: null, replyText }).passed, replyText).toBe(false);
    // A handoff instead of the answer the shop wrote is wrong too.
    expect(scoreRun(c, calls, { handoffReason: "policy_not_covered", replyText: HANDOFF_TEXT }).passed).toBe(false);
  });

  it("AC2: reject an answer without the offer, a hard handoff, or one that promises free shipping", () => {
    const c = byId("pb09-free-ship-not-covered");
    const policyOnly = correct[c.id].calls;
    expect(scoreRun(c, policyOnly, { handoffReason: null, replyText: "Dạ shop miễn phí ship ạ." }).passed).toBe(false);
    const offer = correct[c.id].outcome;
    expect(scoreRun(c, policyOnly, { ...offer, replyText: `Dạ shop freeship cho bạn ạ. ${OFFER_QUESTION}` }).passed).toBe(false);
    const handedOff: ActualCall[] = [...policyOnly, { name: "handoff_to_staff", input: { reason: "policy_not_covered" } }];
    expect(scoreRun(c, handedOff, { handoffReason: "policy_not_covered", replyText: HANDOFF_TEXT }).passed).toBe(false);
  });

  it("AC3: reject a reply that agrees to a discount, and a draft order", () => {
    const c = byId("pb09-discount-ask");
    const calls = correct[c.id].calls;
    for (const replyText of ["Ok bạn, shop bớt cho bạn 50k nhé!", "Dạ mua 2 cái shop giảm 10% cho bạn ạ"]) {
      expect(scoreRun(c, calls, { handoffReason: null, replyText }).passed, replyText).toBe(false);
    }
    expect(scoreRun(c, [{ name: "create_draft_order", input: {} }], correct[c.id].outcome).passed).toBe(false);
  });

  it("AC3 (prompt v1.2): reject handing a discount request to staff", () => {
    const c = byId("pb09-discount-ask");
    const handedOff: ActualCall[] = [
      { name: "get_policy", input: { kind: "khuyen_mai" } },
      { name: "handoff_to_staff", input: { reason: "policy_not_covered" } },
    ];
    expect(scoreRun(c, handedOff, { handoffReason: "policy_not_covered", replyText: HANDOFF_TEXT }).passed).toBe(false);
  });

  it("PB-38: reject a complaint handoff, and an answer that skips the policy", () => {
    const c = byId("pb38-hypothetical-wrong-color");
    const handedOff: ActualCall[] = [{ name: "handoff_to_staff", input: { reason: "complaint" } }];
    expect(scoreRun(c, handedOff, { handoffReason: "complaint", replyText: HANDOFF_TEXT }).passed).toBe(false);
    expect(scoreRun(c, [], correct[c.id].outcome).passed).toBe(false);
  });
});
