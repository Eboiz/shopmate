// The live run loop (pnpm eval:live): one new shopper per run, paced under the
// production limits, scored from data, one progress line per run. IO goes through
// the injected Transport (HTTP + read-only DB in scripts/eval-live.ts, a recorded
// results file in --fake mode), so this file is testable without a network.
import { caseData, turnText, type LiveCase } from "./live-cases.ts";
import { formatCountdown, hourlyBudget, LIMITS, sendDelay, waitForBudget } from "./live-pacing.ts";
import { scoreLiveRun } from "./live-results.ts";
import { classifyInfra } from "./live-score.ts";
import { RESULTS_KIND, type CaseResults, type LiveResults, type RunRecord, type RunResult, type ShopSnapshot, type TurnRecord } from "./live-types.ts";

// One run = one shopper. The transport fills cookie / conversationId on the first turn.
export type Session = { caseId: string; run: number; cookie: string | null; conversationId: string | null };

export type Transport = {
  turn(session: Session, text: string, productId: string | null): Promise<TurnRecord>;
  hasOrder(session: Session): Promise<boolean>;
  finish(session: Session, watchVariantIds: string[]): Promise<Pick<RunRecord, "orders" | "stockAfter">>;
};
export type Clock = { now(): number; sleep(ms: number): Promise<void> };
// Start times of new-shopper requests from this machine (kept in a file between runs).
export type Ledger = { times(): number[]; add(t: number): void };

export type RunnerOptions = {
  cases: LiveCase[];
  runs: number;
  snapshot: ShopSnapshot;
  transport: Transport;
  clock: Clock;
  ledger: Ledger;
  log: (line: string) => void;
  // Wait (with a countdown) when the hourly new-shopper budget is short, instead of refusing.
  wait: boolean;
  meta: Pick<LiveResults, "base" | "shop" | "group" | "filters" | "fake">;
  // Two infra errors in a row stop the run.
  maxInfraInARow?: number;
  // false only for --fake (nothing is sent): skip the 20-per-hour refusal.
  enforceBudget?: boolean;
};

export class PlanRefused extends Error {}

export const OUTCOME_LABEL = { pass: "ĐẠT", fail: "TRƯỢT", infra: "HẠ TẦNG", skip: "BỎ QUA" } as const;

export async function runLive(o: RunnerOptions): Promise<LiveResults> {
  const startedAt = new Date(o.clock.now()).toISOString();
  const runnable = o.cases.filter((c) => !c.precondition?.(caseData(o.snapshot, c)));
  const need = runnable.length * o.runs;

  // 1. The new-shopper budget, before any request.
  if (o.enforceBudget !== false && need > LIMITS.newShoppersPerHour) {
    throw new PlanRefused(
      `Kế hoạch cần ${need} khách mới, vượt giới hạn ${LIMITS.newShoppersPerHour}/giờ của production. Chạy từng nhóm: --group 1, --group 2, ... (xem --plan).`,
    );
  }
  let wait = o.enforceBudget === false ? 0 : waitForBudget(o.ledger.times(), o.clock.now(), need);
  if (wait > 0) {
    const { remaining } = hourlyBudget(o.ledger.times(), o.clock.now());
    if (!o.wait) throw new PlanRefused(`Cần ${need} khách mới nhưng giờ này chỉ còn ${remaining}/${LIMITS.newShoppersPerHour}. Chờ ${formatCountdown(wait)} hoặc chạy lại với --wait.`);
    while (wait > 0) {
      const { remaining: left } = hourlyBudget(o.ledger.times(), o.clock.now());
      o.log(`⏳ Còn ${left}/${LIMITS.newShoppersPerHour} khách mới trong giờ này, cần ${need}: chờ ${formatCountdown(wait)}`);
      await o.clock.sleep(Math.min(wait, 30_000));
      wait = waitForBudget(o.ledger.times(), o.clock.now(), need);
    }
  }
  o.log(`Kế hoạch: ${o.cases.length} case × ${o.runs} lần = ${need} khách mới (còn ${hourlyBudget(o.ledger.times(), o.clock.now()).remaining}/${LIMITS.newShoppersPerHour} trong giờ này)`);

  const sent: number[] = [];
  const total = o.cases.length * o.runs;
  const tally = { pass: 0, fail: 0, infra: 0, skip: 0 };
  let index = 0;
  let infraInARow = 0;
  let stopped: string | null = null;
  const results: CaseResults[] = [];

  for (const c of o.cases) {
    const entry: CaseResults = { id: c.id, issue: c.issue, title: c.title, viewing: c.viewing ?? null, turns: c.turns.map(turnText), runs: [] };
    results.push(entry);
    if (stopped) continue;
    const data = caseData(o.snapshot, c);
    const productId = data.viewing?.id ?? null;
    const watch = c.watchStock && data.viewing ? data.viewing.variants.map((v) => v.id) : [];

    for (let run = 1; run <= o.runs && !stopped; run++) {
      index++;
      const session: Session = { caseId: c.id, run, cookie: null, conversationId: null };
      const record: RunRecord = { conversationId: null, turns: [], orders: [], stockAfter: {} };
      const runStart = o.clock.now();
      const skipped = c.precondition?.(data) ?? null;

      if (!skipped) {
        for (const spec of c.turns) {
          if (typeof spec !== "string" && spec.skipIfOrder && session.conversationId && (await o.transport.hasOrder(session))) continue;
          const delay = sendDelay(sent, o.clock.now());
          if (delay > 0) await o.clock.sleep(delay);
          const at = o.clock.now();
          sent.push(at);
          if (session.cookie === null) o.ledger.add(at);
          const turn = await o.transport.turn(session, turnText(spec), productId);
          record.turns.push(turn);
          if (classifyInfra(turn)) break;
        }
        record.conversationId = session.conversationId;
        if (session.conversationId) Object.assign(record, await o.transport.finish(session, watch));
      }

      const scored = scoreLiveRun(c, o.snapshot, record);
      const aiTurns = record.turns.map((t) => t.aiTurn).filter((t) => t !== null);
      const result: RunResult = {
        caseId: c.id,
        issue: c.issue,
        run,
        outcome: scored.outcome,
        reason: scored.reason,
        checks: scored.checks,
        record,
        model: aiTurns.at(-1)?.model ?? null,
        promptVersion: aiTurns.at(-1)?.promptVersion ?? null,
        wallMs: record.turns.reduce((s, t) => s + t.wallMs, 0),
        tokens: { input: aiTurns.reduce((s, t) => s + t.inputTokens, 0), output: aiTurns.reduce((s, t) => s + t.outputTokens, 0) },
        startedAt: new Date(runStart).toISOString(),
      };
      entry.runs.push(result);
      tally[scored.outcome]++;
      infraInARow = scored.outcome === "infra" ? infraInARow + 1 : 0;

      const { remaining } = hourlyBudget(o.ledger.times(), o.clock.now());
      o.log(
        `[${String(index).padStart(String(total).length)}/${total}] ${c.id.padEnd(20)} lần ${run}/${o.runs}  ${OUTCOME_LABEL[scored.outcome].padEnd(7)} ${(result.wallMs / 1000).toFixed(1).padStart(5)}s  ${shorten(scored.reason, 90)}` +
          `  | ${tally.pass} đạt · ${tally.fail} trượt · ${tally.infra} hạ tầng · ${tally.skip} bỏ qua · còn ${remaining}/${LIMITS.newShoppersPerHour} khách mới/giờ`,
      );
      if (infraInARow >= (o.maxInfraInARow ?? 2)) {
        stopped = `Dừng sau ${infraInARow} lỗi hạ tầng liên tiếp (lần cuối: ${scored.reason})`;
        o.log(`✗ ${stopped}`);
      }
    }
  }

  return {
    kind: RESULTS_KIND,
    version: 1,
    startedAt,
    finishedAt: new Date(o.clock.now()).toISOString(),
    runsPerCase: o.runs,
    snapshot: o.snapshot,
    cases: results,
    stopped,
    ...o.meta,
  };
}

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// A clock that only moves when slept on: --fake mode and tests show the pacing
// waits without waiting.
export function virtualClock(start: number): Clock {
  let t = start;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

export const memoryLedger = (initial: number[] = []): Ledger => {
  const times = [...initial];
  return { times: () => times, add: (t) => void times.push(t) };
};
