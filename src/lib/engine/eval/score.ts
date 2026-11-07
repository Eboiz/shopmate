// Scores one engine run against a labeled case. Pure: no IO.
import { callKey } from "../metrics";
import type { ArgMatcher, EvalCase, ExpectedCall } from "./cases";

export type ActualCall = { name: string; input: unknown };

export type RunScore = {
  requiredTotal: number;
  requiredHit: number; // missing = requiredTotal - requiredHit
  callsTotal: number;
  // Calls to an expected tool: arguments match the label / don't.
  paramMatched: number;
  paramMismatched: number;
  // Calls to a tool not in expected, or repeating the same name + input.
  unnecessary: number;
  // The reply text passes the case's replyMustNot check (true when it has none).
  replyOk: boolean;
  passed: boolean; // requiredHit === requiredTotal && paramMismatched === 0 && unnecessary === 0 && replyOk
};

function argsMatch(args: ArgMatcher | undefined, input: unknown): boolean {
  if (!args) return true;
  const values = (input ?? {}) as Record<string, unknown>;
  return Object.entries(args).every(([key, want]) =>
    typeof want === "function" ? (want as (v: unknown) => boolean)(values[key]) : values[key] === want,
  );
}

const matches = (e: ExpectedCall, call: ActualCall) => e.tool === call.name && argsMatch(e.args, call.input);

export function scoreRun(c: EvalCase, calls: ActualCall[], reply = ""): RunScore {
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
  const requiredHit = required.filter((e) => calls.some((call) => matches(e, call))).length;
  const replyOk = !c.replyMustNot?.check(reply);
  return {
    requiredTotal: required.length,
    requiredHit,
    callsTotal: calls.length,
    paramMatched,
    paramMismatched,
    unnecessary,
    replyOk,
    passed: requiredHit === required.length && paramMismatched === 0 && unnecessary === 0 && replyOk,
  };
}

export function aggregate(scores: RunScore[]): {
  passRate: number;
  recall: number | null;
  paramAccuracy: number | null;
  necessityPrecision: number | null;
} {
  const sum = (f: (s: RunScore) => number) => scores.reduce((total, s) => total + f(s), 0);
  const requiredTotal = sum((s) => s.requiredTotal);
  const params = sum((s) => s.paramMatched + s.paramMismatched);
  const callsTotal = sum((s) => s.callsTotal);
  return {
    passRate: scores.length === 0 ? 0 : scores.filter((s) => s.passed).length / scores.length,
    recall: requiredTotal === 0 ? null : sum((s) => s.requiredHit) / requiredTotal,
    paramAccuracy: params === 0 ? null : sum((s) => s.paramMatched) / params,
    necessityPrecision: callsTotal === 0 ? null : 1 - sum((s) => s.unnecessary) / callsTotal,
  };
}
