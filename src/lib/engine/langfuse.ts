import type { TurnMetrics } from "./metrics";

// Sends one engine turn to Langfuse Cloud as a trace with one generation per
// model call and one span per tool call. Uses the public ingestion REST API, so
// there is no SDK and nothing to flush on a timer: the returned promise is the
// whole send, and runEngine hands it to turnLogged (after()/waitUntil on serverless).
//
// Privacy: built only from TurnMetrics, which never holds message text, tool
// input or customer data. Keep it that way: do not add content here.
//
// Timing: TurnMetrics has durations but not start times, so every child starts
// at the turn start and ends after its own duration. Bar lengths are right; the
// order of calls inside the turn is not shown (metadata.timing says so).

export type LangfuseConfig = {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
};

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const DEFAULT_BASE_URL = "https://cloud.langfuse.com";
const SEND_TIMEOUT_MS = 5000;

// null when the keys are not set: Langfuse is then simply off.
export function langfuseConfigFromEnv(env: Record<string, string | undefined> = process.env): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return null;
  const baseUrl = (env.LANGFUSE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { publicKey, secretKey, baseUrl };
}

type IngestionEvent = { id: string; type: string; timestamp: string; body: Record<string, unknown> };

// endedAt: when the turn finished (a Date.now() value). ids: injectable for tests.
export function buildLangfuseBatch(
  m: TurnMetrics,
  endedAt: number,
  newId: () => string = () => crypto.randomUUID(),
): IngestionEvent[] {
  const startedAt = endedAt - m.latencyMs;
  const iso = (t: number) => new Date(t).toISOString();
  const traceId = newId();
  const event = (type: string, body: Record<string, unknown>): IngestionEvent => ({
    id: newId(),
    type,
    timestamp: iso(endedAt),
    body,
  });

  const events: IngestionEvent[] = [
    event("trace-create", {
      id: traceId,
      name: "engine_turn",
      timestamp: iso(startedAt),
      tags: [m.mode, `prompt:${m.promptVersion}`],
      metadata: {
        shopId: m.shopId,
        mode: m.mode,
        promptVersion: m.promptVersion,
        latencyMs: m.latencyMs,
        ttftMs: m.ttftMs,
        duplicateToolCalls: m.duplicateToolCalls,
        handoffReason: m.handoffReason,
        truncated: m.truncated,
        timing: "children all start at turn start; only durations are exact",
      },
    }),
  ];

  m.modelCalls.forEach((c, i) => {
    events.push(
      event("generation-create", {
        id: newId(),
        traceId,
        name: `model_call_${i + 1}`,
        model: m.model,
        startTime: iso(startedAt),
        endTime: iso(startedAt + c.ms),
        completionStartTime: c.ttftMs === null ? undefined : iso(startedAt + c.ttftMs),
        usageDetails: {
          input: c.inputTokens,
          output: c.outputTokens,
          cache_read_input_tokens: c.cacheReadTokens,
          cache_creation_input_tokens: c.cacheCreationTokens,
        },
        metadata: { stopReason: c.stopReason },
      }),
    );
  });

  m.toolCalls.forEach((c, i) => {
    const failed = c.outcome !== "ok";
    events.push(
      event("span-create", {
        id: newId(),
        traceId,
        name: `tool:${c.name}`,
        startTime: iso(startedAt),
        endTime: iso(startedAt + c.ms),
        level: failed ? "ERROR" : "DEFAULT",
        statusMessage: failed ? c.outcome : undefined,
        metadata: { index: i, outcome: c.outcome },
      }),
    );
  });

  return events;
}

// Never throws and never rejects: a Langfuse outage must not break a turn.
export async function sendToLangfuse(
  config: LangfuseConfig,
  m: TurnMetrics,
  deps: { fetch?: Fetch; now?: () => number } = {},
): Promise<boolean> {
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }));
  const now = deps.now ?? Date.now;
  try {
    const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
    const res = await doFetch(`${config.baseUrl}/api/public/ingestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ batch: buildLangfuseBatch(m, now()) }),
    });
    // 207 Multi-Status: the request is ok, but single events may carry errors.
    const text = await res.text();
    if (!res.ok) {
      console.error(`engine: langfuse rejected the turn (${res.status})`, text.slice(0, 300));
      return false;
    }
    if (/"errors"\s*:\s*\[\s*\{/.test(text)) {
      console.error("engine: langfuse rejected some events", text.slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("engine: failed to send turn to langfuse", e);
    return false;
  }
}

// The onMetrics sink: null when Langfuse is not configured.
export function createLangfuseSink(
  config: LangfuseConfig | null = langfuseConfigFromEnv(),
  deps: { fetch?: Fetch; now?: () => number } = {},
): ((m: TurnMetrics) => Promise<boolean>) | null {
  if (!config) return null;
  return (m) => sendToLangfuse(config, m, deps);
}
