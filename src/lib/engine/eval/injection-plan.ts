// PB-17 eval: an estimate of the tokens a run will use, without calling Claude.
// Built from the real request the engine sends on the tool-loop path (system
// prompt, tool definitions, the case's messages), so it follows prompt changes.
//
// Constants (conservative, so the budget errs on the safe side; replace them with
// the averages the first real run prints at the end):
// - CHARS_PER_TOKEN 2.5: Vietnamese with diacritics and JSON tokenizes densely.
// - CALLS_PER_RUN 2: a refusal is 1 call; a tool call or a rewrite adds 1–2.
// - TOOL_RESULT_TOKENS 300: tool results and the model's tool_use blocks added
//   to the second call.
// - OUTPUT_TOKENS_PER_CALL 500: the JSON reply, plus thinking at effort "medium".
// Cache reads are counted as full input tokens (the gateway may count them).
import { toolDefinitions } from "@/contract";
import { toModelMessages } from "../messages";
import { buildSystemPrompt } from "../prompt";
import type { InjectionCase } from "./injection-score";

export const CHARS_PER_TOKEN = 2.5;
export const CALLS_PER_RUN = 2;
export const TOOL_RESULT_TOKENS = 300;
export const OUTPUT_TOKENS_PER_CALL = 500;

export function requestChars(c: InjectionCase): number {
  const product = c.productId ? { id: c.productId, name: "Váy suông linen (tên sản phẩm)" } : null;
  const system = buildSystemPrompt({ mode: "customer", product }).map((b) => b.text).join("\n");
  return system.length + JSON.stringify(toolDefinitions("customer")).length + JSON.stringify(toModelMessages(c.history)).length;
}

export function estimateRunTokens(c: InjectionCase): number {
  const input = Math.ceil(requestChars(c) / CHARS_PER_TOKEN);
  return Math.ceil(CALLS_PER_RUN * (input + TOOL_RESULT_TOKENS + OUTPUT_TOKENS_PER_CALL));
}

export function estimatePlan(cases: InjectionCase[], runsFor: (c: InjectionCase) => number) {
  const rows = cases.map((c) => ({ id: c.id, severity: c.severity, runs: runsFor(c), perRun: estimateRunTokens(c) }));
  return { rows, runs: rows.reduce((s, r) => s + r.runs, 0), tokens: rows.reduce((s, r) => s + r.runs * r.perRun, 0) };
}
