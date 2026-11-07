// PB-17 eval: token accounting and a hard budget, so one run can't eat the team
// gateway's quota (07/11: 429 "Token quota exceeded" at 1.5M tokens per window).
// Counts every model call's usage as the gateway likely does: input, output,
// cache creation and cache read. Pure apart from wrapping a ModelClient.
import type { ModelClient } from "../engine";

export type Usage = { input: number; output: number; cacheCreation: number; cacheRead: number };
export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
export const totalTokens = (u: Usage) => u.input + u.output + u.cacheCreation + u.cacheRead;
export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheCreation: a.cacheCreation + b.cacheCreation,
  cacheRead: a.cacheRead + b.cacheRead,
});

type SdkUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};
export function usageOf(usage: SdkUsage | null | undefined): Usage {
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheCreation: usage?.cache_creation_input_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
  };
}

// A 429 (rate limit or the gateway's token quota): stop, never retry.
export function isQuotaError(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 429) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /\b429\b|quota exceeded|token quota|rate[ _-]?limit/i.test(message);
}

export class QuotaStop extends Error {
  constructor(readonly detail: string) {
    super(`quota: ${detail}`);
  }
}

// Wraps a model: every response's usage goes to onUsage; a quota error calls
// onQuota and is rethrown as QuotaStop (so the run is recorded as "not run").
export function countingModel(model: ModelClient, onUsage: (u: Usage) => void, onQuota: (detail: string) => void): ModelClient {
  return {
    async create(params, opts) {
      try {
        const res = await model.create(params, opts);
        onUsage(usageOf(res.usage));
        return res;
      } catch (e) {
        if (isQuotaError(e)) {
          const detail = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          onQuota(detail);
          throw new QuotaStop(detail);
        }
        throw e;
      }
    },
  };
}

// The budget across concurrent runs. A run reserves its estimate before it
// starts; it may start only if spent + reserved + estimate stays within max.
export class TokenBudget {
  spent = 0;
  private reserved = 0;
  constructor(readonly max: number) {}
  tryReserve(estimate: number): boolean {
    if (this.spent + this.reserved + estimate > this.max) return false;
    this.reserved += estimate;
    return true;
  }
  settle(estimate: number, actual: number): void {
    this.reserved -= estimate;
    this.spent += actual;
  }
}

export const DEFAULT_MAX_TOKENS = 400_000;
export function maxTokensFromEnv(v: string | undefined): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

// "critical:3,medium:2,low:1" -> runs per severity (one run, one report). null when unset.
export function parseRunsBySeverity(v: string | undefined): Partial<Record<"critical" | "medium" | "low", number>> | null {
  if (!v?.trim()) return null;
  const out: Partial<Record<"critical" | "medium" | "low", number>> = {};
  for (const part of v.split(",")) {
    const m = /^\s*(critical|medium|low)\s*:\s*(\d+)\s*$/.exec(part);
    if (!m) throw new Error(`EVAL_RUNS_BY_SEVERITY: "${part.trim()}" is not severity:runs (e.g. critical:3,medium:2,low:1)`);
    out[m[1] as "critical" | "medium" | "low"] = Number(m[2]);
  }
  return out;
}

export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
