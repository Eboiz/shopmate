import type { EngineMode, HandoffReason } from "@/contract";
import type { ToolRun } from "./execute-tool";

// "ok" | "unknown_tool" | "tool_not_allowed" | "invalid_input" | a ToolError code
// | "internal_error" (invalid handler output also reaches the model as internal_error).
export type ToolOutcome = string;

// One line per engine turn (event "engine_turn"). Only measurements, tool names,
// result codes, shopId and mode: never message text, tool input or output, or
// the shopper's name or phone.
export type TurnMetrics = {
  event: "engine_turn";
  promptVersion: string;
  model: string;
  mode: EngineMode;
  shopId: string;
  // Start of runEngine until the output is ready; the ai_turns write is not included.
  latencyMs: number;
  // Start of runEngine until the first text token of the last model response;
  // null when the model didn't write the reply (handoff, truncated).
  ttftMs: number | null;
  modelCalls: Array<{
    ms: number;
    ttftMs: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    stopReason: string | null;
  }>;
  // name is a string: the model may call a tool that doesn't exist.
  toolCalls: Array<{ name: string; ms: number; outcome: ToolOutcome }>;
  // Calls repeating the same name and input (keys sorted) within the turn.
  duplicateToolCalls: number;
  // Totals, equal to what is written to ai_turns.
  inputTokens: number;
  outputTokens: number;
  handoffReason: HandoffReason | null;
  truncated: boolean;
};

export function toolOutcome(run: ToolRun): ToolOutcome {
  if (!run.isError) return "ok";
  try {
    const error = JSON.parse(run.content).error;
    return typeof error === "string" ? error : "internal_error";
  } catch {
    return "internal_error";
  }
}

// JSON with object keys sorted, so {a,b} and {b,a} compare equal.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

// The first call of each name + input is not a duplicate; every repeat is.
export function countDuplicateCalls(calls: Array<{ name: string; input: unknown }>): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const { name, input } of calls) {
    const key = `${name}:${stableStringify(input)}`;
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}
