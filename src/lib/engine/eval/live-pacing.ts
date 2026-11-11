// Pacing and planning of the live run (pnpm eval:live). Pure: no IO, times in ms.
//
// Production limits (src/lib/guard/web-chat-limit.ts, per client IP): 20 requests
// without the shopper cookie (new shoppers) per hour, 15 messages per minute in
// one shop, 30 per minute over all shops; PB-17 allows 10 per minute per
// conversation. The runner stays under them with a margin and never relies on a
// 429 to slow down.
import { turnText, type LiveCase } from "./live-cases.ts";

export const LIMITS = { newShoppersPerHour: 20, clientShopPerMinute: 15 } as const;
// 12 messages a minute and 4 s between two sends: under the 15/min shop limit
// even if the browser or a teammate on the same IP sends a few too.
export const PACE = { perMinute: 12, minGapMs: 4000 } as const;
const MINUTE = 60_000;
export const HOUR = 3_600_000;

// How long to wait before the next send, given the start times of earlier sends.
export function sendDelay(sent: number[], now: number, pace: { perMinute: number; minGapMs: number } = PACE): number {
  const recent = sent.filter((t) => now - t < MINUTE).sort((a, b) => a - b);
  let wait = 0;
  const last = recent.at(-1);
  if (last !== undefined) wait = Math.max(wait, last + pace.minGapMs - now);
  if (recent.length >= pace.perMinute) wait = Math.max(wait, recent[recent.length - pace.perMinute] + MINUTE - now);
  return Math.max(0, Math.ceil(wait));
}

// New shoppers this IP used in the last hour (from the local ledger) and what is left.
export function hourlyBudget(ledger: number[], now: number, limit: number = LIMITS.newShoppersPerHour) {
  const used = ledger.filter((t) => now - t < HOUR).length;
  return { used, remaining: Math.max(0, limit - used) };
}

// How long until `need` new shoppers fit in the hourly window: 0 if they fit now,
// Infinity if `need` is over the limit itself.
export function waitForBudget(ledger: number[], now: number, need: number, limit: number = LIMITS.newShoppersPerHour): number {
  if (need > limit) return Infinity;
  const live = ledger.filter((t) => now - t < HOUR).sort((a, b) => a - b);
  const excess = live.length + need - limit;
  if (excess <= 0) return 0;
  // The excess-th oldest entry must leave the window.
  return Math.max(0, live[excess - 1] + HOUR - now + 1000);
}

export const formatCountdown = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// Rough tokens per AI turn, after #53's injection-plan constants: about 5k input
// tokens per model call (system prompt + 8 tool definitions + history), 2 model
// calls, 300 tokens of tool results and 500 output tokens per call, cache reads
// counted as full input. Later turns of a conversation carry more history.
export const TOKENS_PER_TURN = 11_600;
export const TOKENS_PER_EARLIER_TURN = 300;
// Wall time per turn: the AI turn (~8 s) or the pacing gap, plus reads.
export const SECONDS_PER_TURN = 10;

export type PlanRow = { id: string; issue: string; group: number; turns: number; runs: number; newShoppers: number; messages: number; tokens: number };

export function planRows(cases: LiveCase[], runs: number): PlanRow[] {
  return cases.map((c) => {
    const turns = c.turns.length;
    const perRun = Array.from({ length: turns }, (_, i) => TOKENS_PER_TURN + i * TOKENS_PER_EARLIER_TURN).reduce((a, b) => a + b, 0);
    return { id: c.id, issue: c.issue, group: c.group, turns, runs, newShoppers: runs, messages: runs * turns, tokens: runs * perRun };
  });
}

export function planTotals(rows: PlanRow[]) {
  const sum = (f: (r: PlanRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const messages = sum((r) => r.messages);
  return {
    cases: rows.length,
    runs: sum((r) => r.runs),
    newShoppers: sum((r) => r.newShoppers),
    messages,
    tokens: sum((r) => r.tokens),
    minutes: Math.ceil((messages * SECONDS_PER_TURN) / 60),
  };
}

// Totals per group, for `--plan` and the README.
export function groupTotals(cases: LiveCase[], runs: number) {
  const groups = [...new Set(cases.map((c) => c.group))].sort((a, b) => a - b);
  return groups.map((g) => ({ group: g, ...planTotals(planRows(cases.filter((c) => c.group === g), runs)) }));
}

export const turnTexts = (c: LiveCase) => c.turns.map(turnText);
