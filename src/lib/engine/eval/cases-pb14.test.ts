import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { HANDOFF_TEXT } from "../engine";
import { OFFER_QUESTION, OFFER_QUICK_REPLIES } from "../handoff-offer";
import { toModelMessages } from "../messages";
import { evalCases } from "./cases";
import { pb05EvalCases } from "./cases-pb05";
import { pb06Cases } from "./cases-pb06";
import { pb09Cases } from "./cases-pb09";
import { pb14Cases } from "./cases-pb14";
import { scoreRun, type ActualCall, type RunOutcome } from "./score";

const byId = (id: string) => pb14Cases.find((c) => c.id === id)!;

const correct: Record<string, { calls: ActualCall[]; outcome: RunOutcome }> = {
  "pb14-complaint": {
    calls: [{ name: "handoff_to_staff", input: { reason: "complaint" } }],
    outcome: { handoffReason: "complaint", replyText: HANDOFF_TEXT },
  },
  "pb14-asked-for-human": {
    calls: [{ name: "handoff_to_staff", input: { reason: "asked_for_human" } }],
    outcome: { handoffReason: "asked_for_human", replyText: HANDOFF_TEXT },
  },
  // PB-31 soft handoff: offered, not handed off; the offer's call is not logged.
  "pb14-fabric-stretch-not-covered": {
    calls: [],
    outcome: {
      handoffReason: null,
      handoffOffer: "not_covered_by_data",
      replyText: `Dạ thông tin này shop chưa ghi trong mô tả sản phẩm. ${OFFER_QUESTION}`,
      quickReplies: OFFER_QUICK_REPLIES,
    },
  },
  // PB-31 soft handoff: offered, not handed off; the offer's call is not logged.
  "pb14-washing-not-covered": {
    calls: [],
    outcome: {
      handoffReason: null,
      handoffOffer: "not_covered_by_data",
      replyText: `Dạ thông tin này shop chưa ghi trong mô tả sản phẩm. ${OFFER_QUESTION}`,
      quickReplies: OFFER_QUICK_REPLIES,
    },
  },
  "pb14-ununderstood-twice": {
    calls: [{ name: "handoff_to_staff", input: { reason: "misunderstood_twice" } }],
    outcome: { handoffReason: "misunderstood_twice", replyText: HANDOFF_TEXT },
  },
};

describe("pb14Cases", () => {
  it("are valid and don't clash with existing eval cases", () => {
    const existing = new Set([...evalCases, ...pb05EvalCases, ...pb06Cases, ...pb09Cases].map((c) => c.id));
    for (const c of pb14Cases) {
      expect(existing.has(c.id), c.id).toBe(false);
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
    }
  });

  it("accept a correct run", () => {
    for (const c of pb14Cases) {
      const run = correct[c.id];
      expect(run, `no correct run for ${c.id}`).toBeDefined();
      expect(scoreRun(c, run.calls, run.outcome).passed, c.id).toBe(true);
    }
  });

  it("reject a run that answers without handoff", () => {
    const c = byId("pb14-complaint");
    const wrong = scoreRun(c, [], { handoffReason: null, replyText: "Dạ shop xin lỗi bạn nhiều ạ." });
    expect(wrong.passed).toBe(false);
  });

  it("reject a hard handoff where an offer is expected", () => {
    const c = byId("pb14-washing-not-covered");
    const handedOff = [{ name: "handoff_to_staff", input: { reason: "not_covered_by_data" } }];
    expect(scoreRun(c, handedOff, { handoffReason: "not_covered_by_data", replyText: HANDOFF_TEXT }).passed).toBe(false);
  });

  it("reject a run that invents fabric stretch info instead of handing off", () => {
    const c = byId("pb14-fabric-stretch-not-covered");
    const wrong = scoreRun(c, [], { handoffReason: null, replyText: "Dạ vải linen này co giãn 4 chiều mặc rất mát ạ." });
    expect(wrong.passed).toBe(false);
  });

  it("reject a run that invents washing info instead of handing off", () => {
    const c = byId("pb14-washing-not-covered");
    const wrong = scoreRun(c, [], { handoffReason: null, replyText: "Dạ áo này giặt máy thoải mái không bị co rút nhé." });
    expect(wrong.passed).toBe(false);
  });
});
