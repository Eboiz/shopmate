// Scores one engine run against a labeled case. Pure: no IO.
import type { HandoffReason, ProductCard } from "@/contract";
import { OFFER_YES, type OfferReason } from "../handoff-offer";
import { callKey } from "../metrics";
import type { ArgMatcher, EvalCase, ExpectedCall, OutcomeLabel } from "./cases";

// `output` is the tool's logged output (ai_turns.tool_calls); only `finds` labels read it.
export type ActualCall = { name: string; input: unknown; output?: unknown };
// What the shopper got. Needed only for cases with a `handoff`, `outcome`,
// `reply` or `quickReplies` label, and for the decision numbers (PB-31).
export type RunOutcome = {
  handoffReason: HandoffReason | null;
  replyText: string;
  // PB-31 soft handoff: the turn's ai_turns.handoff_offer (the reason staff was offered for).
  handoffOffer?: OfferReason | null;
  quickReplies?: string[];
  products?: ProductCard[];
};

// PB-31: what the turn decided. handoff = the conversation went to staff;
// offer = the AI asked "Bạn có muốn mình nhờ nhân viên…" and kept the
// conversation; answer = neither.
export type Decision = "answer" | "offer" | "handoff";

export type RunScore = {
  requiredTotal: number;
  requiredHit: number; // missing = requiredTotal - requiredHit
  callsTotal: number;
  // Calls to an expected tool: arguments match the label / don't.
  paramMatched: number;
  paramMismatched: number;
  // Calls to a tool not in expected, or repeating the same name + input.
  unnecessary: number;
  // The case's labels: null when the case has none.
  handoffOk: boolean | null;
  replyOk: boolean | null;
  outcomeOk: boolean | null; // decision + reason match one of the case's `outcome` labels
  findsOk: boolean | null; // a search_products output contains the `finds` product
  quickRepliesOk: boolean | null;
  productsOk: boolean | null; // PB-40
  // null when the run has no outcome to read.
  decision: Decision | null;
  // The decision matches the case's label: its `outcome` labels when it has
  // them, else `shouldHandOff` (hand off or offer) vs answer. Not part of
  // `passed`: it feeds the "correct decision" number.
  decisionOk: boolean | null;
  // requiredHit === requiredTotal && paramMismatched === 0 && unnecessary === 0,
  // and no label check is false.
  passed: boolean;
};

function argsMatch(args: ArgMatcher | undefined, input: unknown): boolean {
  if (!args) return true;
  const values = (input ?? {}) as Record<string, unknown>;
  return Object.entries(args).every(([key, want]) =>
    typeof want === "function" ? (want as (v: unknown) => boolean)(values[key]) : values[key] === want,
  );
}

const matches = (e: ExpectedCall, call: ActualCall) => e.tool === call.name && argsMatch(e.args, call.input);

export function decisionOf(o: RunOutcome): Decision {
  if (o.handoffReason !== null) return "handoff";
  if (o.handoffOffer || o.quickReplies?.includes(OFFER_YES)) return "offer";
  return "answer";
}

export const outcomeLabels = (c: EvalCase): OutcomeLabel[] =>
  c.outcome === undefined ? [] : Array.isArray(c.outcome) ? c.outcome : [c.outcome];

function outcomeMatches(label: OutcomeLabel, o: RunOutcome): boolean {
  switch (label.decision) {
    case "answer":
      return decisionOf(o) === "answer";
    case "offer":
      return decisionOf(o) === "offer" && o.handoffOffer === label.reason;
    case "handoff":
      return o.handoffReason === label.reason;
  }
}

function searchFound(calls: ActualCall[], productId: string): boolean {
  return calls.some((call) => {
    if (call.name !== "search_products") return false;
    const out = call.output as { match?: string; products?: { productId?: string }[] } | undefined;
    return out?.match !== "none" && (out?.products ?? []).some((p) => p.productId === productId);
  });
}

// The Jev router resolves the product itself and calls a product tool directly,
// never search_products: a product tool run on the expected product finds it too.
const PRODUCT_TOOLS = new Set(["get_stock", "recommend_size", "get_pairings"]);
function productToolRan(calls: ActualCall[], productId: string): boolean {
  return calls.some((call) => PRODUCT_TOOLS.has(call.name) && (call.input as { productId?: unknown } | null)?.productId === productId);
}

export function scoreRun(c: EvalCase, calls: ActualCall[], outcome?: RunOutcome): RunScore {
  const seen = new Set<string>();
  let paramMatched = 0;
  let paramMismatched = 0;
  let unnecessary = 0;
  for (const call of calls) {
    const key = callKey(call.name, call.input);
    if (seen.has(key)) {
      unnecessary++;
      continue;
    }
    seen.add(key);
    const sameTool = c.expected.filter((e) => e.tool === call.name);
    if (sameTool.length === 0) unnecessary++;
    else if (sameTool.some((e) => argsMatch(e.args, call.input))) paramMatched++;
    else paramMismatched++;
  }
  const required = c.expected.filter((e) => e.required);
  const directFind = c.finds !== undefined && productToolRan(calls, c.finds);
  // A required search is met when the router found the `finds` product directly.
  const requiredHit = required.filter((e) =>
    calls.some((call) => matches(e, call)) || (e.tool === "search_products" && directFind),
  ).length;
  // A label with no outcome to check against fails rather than passing silently.
  const handoffOk = c.handoff === undefined ? null : outcome?.handoffReason === c.handoff;
  const replyOk = c.reply === undefined ? null : outcome !== undefined && c.reply.ok(outcome.replyText);
  const labels = outcomeLabels(c);
  const outcomeOk = labels.length === 0 ? null : outcome !== undefined && labels.some((l) => outcomeMatches(l, outcome));
  const findsOk = c.finds === undefined ? null : searchFound(calls, c.finds) || directFind;
  const quickRepliesOk = c.quickReplies === undefined ? null : outcome !== undefined && c.quickReplies.ok(outcome.quickReplies ?? []);
  const productsOk = c.products === undefined ? null : outcome !== undefined && c.products.ok(outcome.products ?? []);
  const decision = outcome === undefined ? null : decisionOf(outcome);
  const decisionOk =
    decision === null
      ? null
      : labels.length > 0
        ? labels.some((l) => l.decision === decision)
        : c.shouldHandOff === (decision !== "answer");
  return {
    requiredTotal: required.length,
    requiredHit,
    callsTotal: calls.length,
    paramMatched,
    paramMismatched,
    unnecessary,
    handoffOk,
    replyOk,
    outcomeOk,
    findsOk,
    quickRepliesOk,
    productsOk,
    decision,
    decisionOk,
    passed:
      requiredHit === required.length &&
      paramMismatched === 0 &&
      unnecessary === 0 &&
      [handoffOk, replyOk, outcomeOk, findsOk, quickRepliesOk, productsOk].every((ok) => ok !== false),
  };
}

export function aggregate(scores: RunScore[]): {
  passRate: number;
  recall: number | null;
  paramAccuracy: number | null;
  necessityPrecision: number | null;
  // PB-31, over runs with an outcome (null when none):
  handoffRate: number | null; // share of runs that ended in a real handoff
  offerRate: number | null; // share of runs that offered staff (soft handoff)
  correctDecision: number | null; // share of runs whose answer/offer/handoff decision matches the label
} {
  const sum = (f: (s: RunScore) => number) => scores.reduce((total, s) => total + f(s), 0);
  const requiredTotal = sum((s) => s.requiredTotal);
  const params = sum((s) => s.paramMatched + s.paramMismatched);
  const callsTotal = sum((s) => s.callsTotal);
  const decided = scores.filter((s) => s.decision !== null);
  const share = (f: (s: RunScore) => boolean) => (decided.length === 0 ? null : decided.filter(f).length / decided.length);
  return {
    passRate: scores.length === 0 ? 0 : scores.filter((s) => s.passed).length / scores.length,
    recall: requiredTotal === 0 ? null : sum((s) => s.requiredHit) / requiredTotal,
    paramAccuracy: params === 0 ? null : sum((s) => s.paramMatched) / params,
    necessityPrecision: callsTotal === 0 ? null : 1 - sum((s) => s.unnecessary) / callsTotal,
    handoffRate: share((s) => s.decision === "handoff"),
    offerRate: share((s) => s.decision === "offer"),
    correctDecision: share((s) => s.decisionOk === true),
  };
}
