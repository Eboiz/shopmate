// --fake mode of pnpm eval:live: replays a results file (the bundled fixture, or
// a real run's eval-runs/*.json) instead of calling the deployment, so the progress
// output, scoring and HTML report can be shown without production or Claude.
// The replay is re-scored with the current cases. Pure apart from the clock.
import type { Clock, Session, Transport } from "./live-runner.ts";
import type { LiveResults, RunResult, TurnRecord } from "./live-types.ts";

export function replayTransport(recorded: LiveResults, clock: Clock): Transport {
  const byCase = new Map(recorded.cases.map((c) => [c.id, c.runs.filter((r) => r.outcome !== "skip")]));
  const position = new Map<Session, number>();
  const runOf = (s: Session): RunResult | undefined => {
    const runs = byCase.get(s.caseId) ?? [];
    return runs.length ? runs[(s.run - 1) % runs.length] : undefined;
  };
  return {
    async turn(session, text, productId) {
      const run = runOf(session);
      const i = position.get(session) ?? 0;
      position.set(session, i + 1);
      const turn = run?.record.turns[i];
      session.cookie ??= "fake-cookie";
      session.conversationId ??= run?.record.conversationId ?? `fake-${session.caseId}-${session.run}`;
      if (!turn) {
        const missing: TurnRecord = {
          shopper: text, productId, httpStatus: 404, status: null,
          error: "Bản ghi không có lượt này (--fake)", wallMs: 0, replies: [], aiTurn: null, modeAfter: null,
        };
        return missing;
      }
      await clock.sleep(turn.wallMs);
      return { ...turn, shopper: text, productId };
    },
    async hasOrder(session) {
      const run = runOf(session);
      return !!run && (position.get(session) ?? 0) >= run.record.turns.length && run.record.orders.length > 0;
    },
    async finish(session) {
      const run = runOf(session);
      return { orders: run?.record.orders ?? [], stockAfter: run?.record.stockAfter ?? {} };
    },
  };
}
