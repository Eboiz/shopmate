import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, startObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { TurnMetrics } from "./metrics";

// Sends each engine turn to Langfuse Cloud with the Langfuse JS/TS SDK v6
// (OpenTelemetry). The old REST ingestion API is shut down for traces on
// 2026-11-16, so do not go back to POST /api/public/ingestion.
//
// Shape of a trace (Langfuse best practices: one trace per turn, one session per
// conversation, a generation per model call, a tool observation per tool call):
//   engine_turn (agent)
//   ├─ model_call_1 (generation: model, token usage, time to first token)
//   ├─ tool:search_products (tool)
//   └─ model_call_2 (generation)
//
// Privacy: built only from TurnMetrics, which never holds message text, tool
// input/output or customer data, so no observation has input or output. Adding
// content here would break the PB-03 rule; ask first.

export type LangfuseConfig = { publicKey: string; secretKey: string; baseUrl: string };

const DEFAULT_BASE_URL = "https://cloud.langfuse.com";

// null when the keys are not set: Langfuse is then simply off.
export function langfuseConfigFromEnv(env: Record<string, string | undefined> = process.env): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return null;
  const baseUrl = (env.LANGFUSE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { publicKey, secretKey, baseUrl };
}

// One OpenTelemetry SDK per process. Kept on globalThis because Next.js can load
// this module more than once (route bundles, dev reloads) and a second SDK would
// double-register the global tracer provider.
type Runtime = { processor: LangfuseSpanProcessor };
const holder = globalThis as typeof globalThis & { __shopmateLangfuse?: Runtime };

function ensureRuntime(config: LangfuseConfig): Runtime {
  if (holder.__shopmateLangfuse) return holder.__shopmateLangfuse;
  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV,
  });
  new NodeSDK({ spanProcessors: [processor] }).start();
  return (holder.__shopmateLangfuse = { processor });
}

// Creates the observations for one finished turn. Needs a tracer provider
// (ensureRuntime, or one set by a test).
export function recordTurn(m: TurnMetrics, endedAt: number): void {
  const startedAt = endedAt - m.latencyMs;
  const at = (offsetMs: number) => new Date(startedAt + offsetMs);

  propagateAttributes(
    {
      traceName: "engine_turn",
      sessionId: m.conversationId ?? undefined,
      tags: [m.mode, `prompt:${m.promptVersion}`],
      version: m.promptVersion,
      metadata: { shopId: m.shopId, mode: m.mode },
    },
    () => {
      const turn = startObservation(
        "engine_turn",
        {
          level: m.truncated || m.handoffReason ? "WARNING" : "DEFAULT",
          statusMessage: m.handoffReason ?? (m.truncated ? "truncated" : undefined),
          metadata: {
            latencyMs: m.latencyMs,
            ttftMs: m.ttftMs,
            duplicateToolCalls: m.duplicateToolCalls,
            handoffReason: m.handoffReason,
            truncated: m.truncated,
          },
        },
        { asType: "agent", startTime: at(0) },
      );

      m.modelCalls.forEach((c, i) => {
        const generation = startObservation(
          `model_call_${i + 1}`,
          {
            model: m.model,
            usageDetails: {
              input: c.inputTokens,
              output: c.outputTokens,
              cache_read_input_tokens: c.cacheReadTokens,
              cache_creation_input_tokens: c.cacheCreationTokens,
            },
            completionStartTime: c.ttftMs === null ? undefined : at(c.startMs + c.ttftMs),
            metadata: { stopReason: c.stopReason },
          },
          { asType: "generation", startTime: at(c.startMs), parentSpanContext: turn.otelSpan.spanContext() },
        );
        generation.end(at(c.startMs + c.ms));
      });

      m.toolCalls.forEach((c) => {
        const failed = c.outcome !== "ok";
        const tool = startObservation(
          `tool:${c.name}`,
          { level: failed ? "ERROR" : "DEFAULT", statusMessage: failed ? c.outcome : undefined, metadata: { outcome: c.outcome } },
          { asType: "tool", startTime: at(c.startMs), parentSpanContext: turn.otelSpan.spanContext() },
        );
        tool.end(at(c.startMs + c.ms));
      });

      turn.end(at(m.latencyMs));
    },
  );
}

// Never throws and never rejects: a Langfuse outage must not break a turn.
// Resolves after the spans were handed to Langfuse, so runEngine's turnLogged
// (after()/waitUntil on serverless) keeps the process alive until then.
export async function sendToLangfuse(
  config: LangfuseConfig,
  m: TurnMetrics,
  deps: { now?: () => number; flush?: () => Promise<void> } = {},
): Promise<boolean> {
  try {
    const runtime = ensureRuntime(config);
    recordTurn(m, (deps.now ?? Date.now)());
    await (deps.flush ?? (() => runtime.processor.forceFlush()))();
    return true;
  } catch (e) {
    console.error("engine: failed to send turn to langfuse", e);
    return false;
  }
}

// The onMetrics sink: null when Langfuse is not configured.
export function createLangfuseSink(
  config: LangfuseConfig | null = langfuseConfigFromEnv(),
): ((m: TurnMetrics) => Promise<boolean>) | null {
  if (!config) return null;
  return (m) => sendToLangfuse(config, m);
}
