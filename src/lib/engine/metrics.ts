// Type-only imports: scripts/engine-metrics.ts runs this file with plain Node.
import type { EngineMode, HandoffReason, Tables } from "@/contract";
import type { ToolRun } from "./execute-tool";

// "ok" | "unknown_tool" | "tool_not_allowed" | "invalid_input" | a ToolError code
// | "internal_error" (invalid handler output also reaches the model as internal_error).
export type ToolOutcome = string;

// One line per engine turn (event "engine_turn"). Only measurements, tool names,
// result codes, shopId and mode: never message text, tool input or output, or
// the shopper's name or phone.
// What the model saw and said, for tracing only. NOT part of TurnMetrics because
// the metrics line is printed to the console and stored as numbers; this can hold
// customer text. `system` is the fixed prompt (plus the product being viewed).
// `calls` is filled only when content capture is on (LANGFUSE_CAPTURE_CONTENT).
export type TurnDetail = {
  system: string;
  calls: Array<{ messages: unknown; output: unknown }>;
};

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
  // Opaque id of the conversation (null in staff_draft); groups turns into a Langfuse session.
  conversationId?: string | null;
  // startMs: when the call began, in ms after the start of runEngine.
  modelCalls: Array<{
    startMs: number;
    ms: number;
    ttftMs: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    stopReason: string | null;
  }>;
  // name is a string: the model may call a tool that doesn't exist.
  toolCalls: Array<{ name: string; startMs: number; ms: number; outcome: ToolOutcome }>;
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

// Same tool and same input, whatever the key order.
export const callKey = (name: string, input: unknown) => `${name}:${stableStringify(input)}`;

// The first call of each name + input is not a duplicate; every repeat is.
export function countDuplicateCalls(calls: Array<{ name: string; input: unknown }>): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const { name, input } of calls) {
    const key = callKey(name, input);
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return duplicates;
}

// ---------------------------------------------------------------------------
// Summaries over many turns (pnpm engine:metrics). Pure: no IO.

export type TurnSample = {
  mode: EngineMode;
  latencyMs: number;
  ttftMs: number | null;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number | null; // null when unknown (ai_turns rows from before PB-03's metrics migration)
  toolCalls: Array<{ name: string; outcome: ToolOutcome }>;
  handoffReason: HandoffReason | null;
};

export function sampleFromMetrics(m: TurnMetrics): TurnSample {
  return {
    mode: m.mode,
    latencyMs: m.latencyMs,
    ttftMs: m.ttftMs,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    modelCalls: m.modelCalls.length,
    toolCalls: m.toolCalls.map(({ name, outcome }) => ({ name, outcome })),
    handoffReason: m.handoffReason,
  };
}

// ai_turns.tool_calls has no unknown_tool entries (executeTool doesn't log them).
export function sampleFromTurnRow(row: Tables<"ai_turns">): TurnSample {
  const logs = (Array.isArray(row.tool_calls) ? row.tool_calls : []) as Array<{ name: string; error?: string }>;
  return {
    mode: row.mode,
    latencyMs: row.latency_ms,
    ttftMs: row.ttft_ms,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    modelCalls: row.model_calls > 0 ? row.model_calls : null,
    toolCalls: logs.map((log) => ({ name: log.name, outcome: log.error?.split(":")[0] ?? "ok" })),
    handoffReason: row.handoff_reason,
  };
}

// Nearest rank: the ceil(p/100 * n)-th smallest value; null for no values.
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export type Percentiles = { p50: number | null; p90: number | null; p99: number | null };

export type GroupSummary = {
  turns: number;
  latency: Percentiles;
  ttft: Percentiles & { n: number }; // only turns with a TTFT
  tools: {
    total: number;
    okRate: number | null;
    byOutcome: Record<string, number>;
    byTool: Record<string, { total: number; okRate: number | null }>;
    invalidInputRate: number | null; // wrong argument shape
    notFoundRate: number | null; // product_not_found / variant_not_found: an id made up or from another shop
  };
  tokens: { inputAvg: number | null; outputAvg: number | null; inputTotal: number; outputTotal: number };
  // Averages over turns that finished without a handoff.
  calls: { modelAvg: number | null; toolAvg: number | null };
  handoff: { rate: number | null; byReason: Record<string, number> };
};

// Split by mode, then by turns with no tool call vs at least one: the two are
// different distributions, and mixing them hides the tail.
export type Summary = { byMode: Record<EngineMode, { noTools: GroupSummary; withTools: GroupSummary }> };

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);
const average = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const percentiles = (values: number[]): Percentiles => ({
  p50: percentile(values, 50),
  p90: percentile(values, 90),
  p99: percentile(values, 99),
});

function summarizeGroup(samples: TurnSample[]): GroupSummary {
  const calls = samples.flatMap((s) => s.toolCalls);
  const count = (outcomes: string[]) => calls.filter((c) => outcomes.includes(c.outcome)).length;
  const byOutcome: Record<string, number> = {};
  const byToolCounts: Record<string, { total: number; ok: number }> = {};
  for (const c of calls) {
    byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
    const t = (byToolCounts[c.name] ??= { total: 0, ok: 0 });
    t.total++;
    if (c.outcome === "ok") t.ok++;
  }
  const ttfts = samples.flatMap((s) => (s.ttftMs === null ? [] : [s.ttftMs]));
  const finished = samples.filter((s) => s.handoffReason === null);
  const byReason: Record<string, number> = {};
  for (const s of samples) if (s.handoffReason) byReason[s.handoffReason] = (byReason[s.handoffReason] ?? 0) + 1;
  const inputTotal = samples.reduce((sum, s) => sum + s.inputTokens, 0);
  const outputTotal = samples.reduce((sum, s) => sum + s.outputTokens, 0);

  return {
    turns: samples.length,
    latency: percentiles(samples.map((s) => s.latencyMs)),
    ttft: { ...percentiles(ttfts), n: ttfts.length },
    tools: {
      total: calls.length,
      okRate: ratio(count(["ok"]), calls.length),
      byOutcome,
      byTool: Object.fromEntries(
        Object.entries(byToolCounts).map(([name, t]) => [name, { total: t.total, okRate: ratio(t.ok, t.total) }]),
      ),
      invalidInputRate: ratio(count(["invalid_input"]), calls.length),
      notFoundRate: ratio(count(["product_not_found", "variant_not_found"]), calls.length),
    },
    tokens: {
      inputAvg: ratio(inputTotal, samples.length),
      outputAvg: ratio(outputTotal, samples.length),
      inputTotal,
      outputTotal,
    },
    calls: {
      modelAvg: average(finished.flatMap((s) => (s.modelCalls === null ? [] : [s.modelCalls]))),
      toolAvg: average(finished.map((s) => s.toolCalls.length)),
    },
    handoff: { rate: ratio(samples.length - finished.length, samples.length), byReason },
  };
}

export function summarize(samples: TurnSample[]): Summary {
  const forMode = (mode: EngineMode) => {
    const own = samples.filter((s) => s.mode === mode);
    return {
      noTools: summarizeGroup(own.filter((s) => s.toolCalls.length === 0)),
      withTools: summarizeGroup(own.filter((s) => s.toolCalls.length > 0)),
    };
  };
  return { byMode: { customer: forMode("customer"), staff_draft: forMode("staff_draft") } };
}
