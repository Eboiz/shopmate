// Scoring one live run of a case, and the per-case / per-issue summary. Pure.
import { caseData, type LiveCase } from "./live-cases.ts";
import { classifyInfra, dataChecks } from "./live-score.ts";
import type { CaseResults, Issue, LiveResults, RunOutcome, RunRecord, ShopSnapshot } from "./live-types.ts";

export type Scored = { outcome: RunOutcome; reason: string; checks: ReturnType<typeof dataChecks> };

export function scoreLiveRun(c: LiveCase, snapshot: ShopSnapshot, record: RunRecord): Scored {
  for (const turn of record.turns) {
    const infra = classifyInfra(turn);
    if (infra) return { outcome: "infra", reason: infra, checks: [] };
  }
  const data = caseData(snapshot, c);
  const pre = c.precondition?.(data) ?? null;
  if (pre) return { outcome: "skip", reason: `Dữ liệu shop không đúng tiền điều kiện: ${pre}`, checks: [] };
  const checks = [...c.check(data, record), ...dataChecks(snapshot, record)];
  const failed = checks.filter((x) => !x.ok);
  return failed.length === 0
    ? { outcome: "pass", reason: `đủ ${checks.length} kiểm tra`, checks }
    : { outcome: "fail", reason: failed.map((x) => (x.detail ? `${x.label} (${x.detail})` : x.label)).join("; "), checks };
}

export type CaseTally = { pass: number; fail: number; infra: number; skip: number; scored: number; wallMsAvg: number };

export function tallyCase(c: CaseResults): CaseTally {
  const count = (o: RunOutcome) => c.runs.filter((r) => r.outcome === o).length;
  const timed = c.runs.filter((r) => r.outcome === "pass" || r.outcome === "fail");
  return {
    pass: count("pass"),
    fail: count("fail"),
    infra: count("infra"),
    skip: count("skip"),
    scored: count("pass") + count("fail"),
    wallMsAvg: timed.length ? Math.round(timed.reduce((s, r) => s + r.wallMs, 0) / timed.length) : 0,
  };
}

// "pass": every case of the issue ran all its runs and all passed.
// "fail": at least one scored run failed.
// "open": nothing failed but some runs are missing (infra error, skipped, stopped).
export type Verdict = "pass" | "fail" | "open";

export function issueVerdicts(results: LiveResults): { issue: Issue; verdict: Verdict; cases: number; pass: number; scored: number; infra: number; skip: number }[] {
  const issues = [...new Set(results.cases.map((c) => c.issue))].sort();
  return issues.map((issue) => {
    const cases = results.cases.filter((c) => c.issue === issue);
    const t = cases.map(tallyCase);
    const sum = (f: (x: CaseTally) => number) => t.reduce((s, x) => s + f(x), 0);
    const complete = cases.every((c, i) => t[i].scored >= results.runsPerCase);
    const verdict: Verdict = sum((x) => x.fail) > 0 ? "fail" : complete ? "pass" : "open";
    return { issue, verdict, cases: cases.length, pass: sum((x) => x.pass), scored: sum((x) => x.scored), infra: sum((x) => x.infra), skip: sum((x) => x.skip) };
  });
}

export function totals(results: LiveResults) {
  const runs = results.cases.flatMap((c) => c.runs);
  const count = (o: RunOutcome) => runs.filter((r) => r.outcome === o).length;
  const tokens = runs.reduce((s, r) => s + r.tokens.input + r.tokens.output, 0);
  return { runs: runs.length, pass: count("pass"), fail: count("fail"), infra: count("infra"), skip: count("skip"), tokens };
}

// Models and prompt versions the runs actually used (from ai_turns).
export function modelsSeen(results: LiveResults): { models: string[]; prompts: string[] } {
  const runs = results.cases.flatMap((c) => c.runs);
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return { models: uniq(runs.map((r) => r.model)), prompts: uniq(runs.map((r) => r.promptVersion)) };
}
