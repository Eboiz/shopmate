import { describe, expect, it } from "vitest";
import { tools } from "@/contract";
import { OFFER_QUICK_REPLIES, sizeOfferText } from "../handoff-offer";
import { extractMeasurements } from "../measurements";
import { recommendSize } from "../tools/recommend-size";
import { toModelMessages } from "../messages";
import { FX } from "../test/two-shops";
import { evalCases } from "./cases";
import { pb06Cases } from "./cases-pb06";
import { scoreRun, type ActualCall, type RunOutcome } from "./score";

const V = FX.a.vay01;
const AO = FX.a.ao03;
// The fixture's chart for Váy suông linen (two-shops.ts).
const chart = [
  { size: "S", height_min_cm: 150, height_max_cm: 157, weight_min_kg: 40, weight_max_kg: 46 },
  { size: "M", height_min_cm: 158, height_max_cm: 164, weight_min_kg: 47, weight_max_kg: 53 },
  { size: "L", height_min_cm: 165, height_max_cm: 172, weight_min_kg: 54, weight_max_kg: 60 },
];

const size = (productId: string, heightCm: number, weightKg: number): ActualCall => ({
  name: "recommend_size",
  input: { productId, heightCm, weightKg },
});

const correct: Record<string, { calls: ActualCall[]; outcome: RunOutcome }> = {
  "size-demo-m": {
    calls: [size(V, 158, 50)],
    outcome: { handoffReason: null, replyText: "Dạ với 158cm, 50kg bạn mặc size M là vừa ạ." },
  },
  "size-phrase-cao-1m6": { calls: [size(V, 160, 50)], outcome: { handoffReason: null, replyText: "Dạ bạn mặc size M ạ." } },
  "size-phrase-weight-first": { calls: [size(V, 160, 50)], outcome: { handoffReason: null, replyText: "Dạ size M nhé." } },
  "size-phrase-1-65m": { calls: [size(V, 165, 55)], outcome: { handoffReason: null, replyText: "Dạ bạn lấy size L nhé." } },
  // PB-31 soft handoff: the server's size text offers staff.
  "size-out-of-range": {
    calls: [size(V, 180, 75)],
    outcome: {
      handoffReason: null,
      handoffOffer: "size_out_of_range",
      replyText: sizeOfferText({ nearestSize: "L", offCm: 8, offKg: 15 }),
      quickReplies: OFFER_QUICK_REPLIES,
    },
  },
  "size-no-chart": {
    calls: [size(AO, 160, 50)],
    outcome: {
      handoffReason: null,
      handoffOffer: "not_covered_by_data",
      replyText: sizeOfferText(null),
      quickReplies: OFFER_QUICK_REPLIES,
    },
  },
};

const wrong: Record<string, RunOutcome> = {
  "size-demo-m": { handoffReason: null, replyText: "Dạ bạn mặc size S hoặc size M đều được." },
  "size-phrase-cao-1m6": { handoffReason: null, replyText: "Dạ bạn mặc size L ạ." },
  "size-phrase-weight-first": { handoffReason: null, replyText: "Dạ size S nhé." },
  "size-phrase-1-65m": { handoffReason: null, replyText: "Dạ bạn lấy size M nhé." },
  "size-out-of-range": { handoffReason: null, replyText: "Dạ bạn mặc size L nhé." },
  "size-no-chart": { handoffReason: null, replyText: "Dạ bạn mặc size M nhé." },
  // (A hard handoff where an offer is expected is checked below.)
};

describe("pb06Cases", () => {
  it("has ids distinct from each other and from the base cases", () => {
    const ids = [...evalCases, ...pb06Cases].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses valid histories, tools and fixture products", () => {
    const shopA = new Set<string>(Object.values(FX.a));
    for (const c of pb06Cases) {
      expect(() => toModelMessages(c.history), c.id).not.toThrow();
      for (const e of c.expected) expect(Object.keys(tools), c.id).toContain(e.tool);
      if (c.productId !== undefined) expect(shopA.has(c.productId), c.id).toBe(true);
    }
  });

  it("each shopper message parses to the numbers the case expects", () => {
    for (const c of pb06Cases) {
      const want = c.expected.find((e) => e.tool === "recommend_size")!.args!;
      expect(extractMeasurements(c.history.at(-1)!.text), c.id).toEqual({ heightCm: want.heightCm, weightKg: want.weightKg });
    }
  });

  it("the labeled sizes are what the size function returns on the fixture chart", () => {
    expect(recommendSize(chart, 158, 50)).toMatchObject({ status: "ok", size: "M" });
    expect(recommendSize(chart, 160, 50)).toMatchObject({ status: "ok", size: "M" });
    expect(recommendSize(chart, 165, 55)).toMatchObject({ status: "ok", size: "L" });
    expect(recommendSize(chart, 180, 75)).toEqual({ status: "out_of_range", nearestSize: "L", offCm: 8, offKg: 15 });
    expect(recommendSize([], 160, 50)).toEqual({ status: "no_chart" });
  });

  it("accepts a correct run and rejects a wrong outcome for every case", () => {
    for (const c of pb06Cases) {
      const run = correct[c.id];
      expect(run, `no correct run for ${c.id}`).toBeDefined();
      expect(run.calls.map((x) => x.name).sort(), c.id).toEqual(c.expected.filter((e) => e.required).map((e) => e.tool).sort());
      expect(scoreRun(c, run.calls, run.outcome).passed, c.id).toBe(true);
      expect(scoreRun(c, run.calls, wrong[c.id]).passed, c.id).toBe(false);
      expect(scoreRun(c, run.calls).passed, c.id).toBe(false);
    }
  });

  it("rejects a hard handoff where the soft handoff offers staff", () => {
    for (const id of ["size-out-of-range", "size-no-chart"]) {
      const c = pb06Cases.find((x) => x.id === id)!;
      const reason = id === "size-no-chart" ? "not_covered_by_data" : "size_out_of_range";
      const run = correct[id];
      expect(scoreRun(c, run.calls, { handoffReason: reason, replyText: run.outcome.replyText }).passed, id).toBe(false);
    }
  });
});
