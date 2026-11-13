// Labeled eval of the engine with real Claude (pnpm engine:eval). Informational
// only: it never fails on a low score; thresholds come once there is a baseline.
//
//   EVAL_RUNS=3 (default)   runs per case
//   EVAL_CASE=<id>          run one case only
//   EVAL_GROUP=<prefix>     run the cases whose id starts with it (replay-, near-, pb14-…)
//   EVAL_LABEL=<name>       name of the saved run (default: the engine path)
//
// Every run is saved to eval-runs/<date>-<label>.json (PB-10: runs can be
// compared at Sprint Review): the summary table, each run's score, route and
// tool calls, and every failure with the reply.
//
// PB-31 adds two quality numbers per row: "handoff rate" (share of runs that
// handed the conversation to staff), "offer rate" (share that offered staff,
// soft handoff) and "correct decision" (share whose answer / offer / handoff
// matches the case's label), so the handoff rate can't drop by the AI answering
// what it should not.
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { TablesInsert } from "@/contract";
import type { Json } from "@/contract/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultModel } from "../anthropic-model";
import { runEngine } from "../engine";
import type { TurnMetrics } from "../metrics";
import { PROMPT_VERSION } from "../prompt";
import { createSupabaseStore, type EngineStore } from "../store";
import { assertLocalDb, FX, seedTwoShops } from "../test/two-shops";
import type { Db } from "../types";
import { evalCases } from "./cases";
import { pb05EvalCases } from "./cases-pb05";
import { pb06Cases } from "./cases-pb06";
import { pb09Cases } from "./cases-pb09";
import { pb14Cases } from "./cases-pb14";
import { pb31Cases } from "./cases-pb31";
import { pb39Cases } from "./cases-pb39";
import { pb08Cases, pb11Cases, pb20Cases } from "./cases-ai02-04";
import { pb40Cases } from "./cases-pb40";
import { aggregate, scoreRun, type ActualCall, type Decision, type RunOutcome, type RunScore } from "./score";

const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const allCases = [...evalCases, ...pb05EvalCases, ...pb06Cases, ...pb09Cases, ...pb14Cases, ...pb31Cases, ...pb39Cases, ...pb08Cases, ...pb11Cases, ...pb20Cases, ...pb40Cases];
const group = process.env.EVAL_GROUP;
const cases = allCases.filter(
  (c) => (!process.env.EVAL_CASE || c.id === process.env.EVAL_CASE) && (!group || c.id.startsWith(group)),
);
// Extra summary rows for the PB-31 groups (only when some of their cases ran).
const GROUP_ROWS: Record<string, string> = { "GROUP replay": "replay-", "GROUP near matches": "near-" };

type Run = {
  score: RunScore;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  modelCalls: number;
  route: TurnMetrics["route"] | null;
  calls: ActualCall[];
  handoffReason: string | null;
  handoffOffer: string | null;
  decision: Decision | null;
  shouldHandOff: boolean;
  replyText: string;
};
const results = new Map<string, Run[]>();

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("engine eval (real Claude)", () => {
  let db: Db;
  let store: EngineStore;
  let model: ReturnType<typeof createDefaultModel>;

  beforeAll(async () => {
    assertLocalDb();
    // Through ANTHROPIC_API_URL (the team gateway) when set, like the engine.
    model = createDefaultModel();
    if (process.env.JEV_IN_TESTS === "true" && !process.env.OPENROUTER_API_KEY?.trim()) {
      console.warn("engine eval: OPENROUTER_API_KEY is not set, so every turn uses the LLM tool loop, not the Jev router production uses.");
    }
    db = createAdminClient();
    store = createSupabaseStore(db);
    await seedTwoShops(db);
  });

  for (const c of cases) {
    it(c.id, { timeout: 120_000 * RUNS }, async () => {
      const runs: Run[] = [];
      for (let i = 0; i < RUNS; i++) {
        // handoff_to_staff moves the conversation; every run starts in mode ai.
        await db.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation);
        // The engine reads the conversation's previous AI turn (PB-05), so earlier
        // runs must not leak into this one: start from the case's own previous turn.
        await db.from("ai_turns").delete().eq("conversation_id", FX.a.conversation);
        if (c.previousTurn) {
          await store.insertTurn({
            shop_id: FX.a.shop,
            conversation_id: FX.a.conversation,
            mode: "customer",
            latency_ms: 0,
            tool_calls: c.previousTurn as NonNullable<Json>,
          });
        }
        let row: TablesInsert<"ai_turns"> | null = null;
        let metrics: TurnMetrics | null = null;
        const capturing: EngineStore = {
          ...store,
          insertTurn: (r) => {
            row = r;
            return store.insertTurn(r);
          },
        };
        const deps = { model, db, store: capturing, onMetrics: (m: TurnMetrics) => void (metrics = m) };
        const result = c.mode === "staff_draft"
          ? await runEngine({ mode: "staff_draft", history: c.history, productId: c.productId ?? null }, { ...deps, staffShopId: FX.a.shop })
          : await runEngine(
            { mode: "customer", conversationId: FX.a.conversation, history: c.history, productId: c.productId ?? null },
            deps,
          );
        await result.turnLogged;
        const turn = row as TablesInsert<"ai_turns"> | null;
        if (!turn) throw new Error(`${c.id}: no ai_turns row`);
        const calls: ActualCall[] = ((turn.tool_calls ?? []) as { name: string; input: unknown; output?: unknown }[]).map(
          (t) => ({ name: t.name, input: t.input, output: t.output }),
        );
        const outcome: RunOutcome = {
          handoffReason: result.handoffReason,
          replyText: result.output.reply.text,
          // PB-31 soft handoff: the reason staff was offered for, and the buttons.
          handoffOffer: (turn.handoff_offer ?? null) as RunOutcome["handoffOffer"],
          quickReplies: result.output.reply.quickReplies,
          products: result.output.reply.products,
        };
        const score = scoreRun(c, calls, outcome);
        if (!score.passed) {
          const shown = calls.map(({ name, input }) => ({ name, input }));
          console.info(`${c.id} failed:`, JSON.stringify({ calls: shown, ...outcome, score }));
        }
        runs.push({
          score,
          latencyMs: turn.latency_ms,
          inputTokens: turn.input_tokens ?? 0,
          outputTokens: turn.output_tokens ?? 0,
          toolCalls: calls.length,
          modelCalls: turn.model_calls ?? 0,
          route: (metrics as TurnMetrics | null)?.route ?? null,
          calls,
          handoffReason: result.handoffReason,
          handoffOffer: outcome.handoffOffer ?? null,
          decision: score.decision,
          shouldHandOff: c.shouldHandOff,
          replyText: result.output.reply.text,
        });
      }
      results.set(c.id, runs);
    });
  }

  afterAll(async () => {
    await db?.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation);
    const fmt = (v: number | null) => (v === null ? "-" : v.toFixed(2));
    const row = (runs: Run[]) => {
      const a = aggregate(runs.map((r) => r.score));
      const avg = (f: (r: Run) => number) => (runs.length ? runs.reduce((s, r) => s + f(r), 0) / runs.length : 0);
      return {
        runs: runs.length,
        passRate: fmt(a.passRate),
        recall: fmt(a.recall),
        paramAccuracy: fmt(a.paramAccuracy),
        necessityPrecision: fmt(a.necessityPrecision),
        "latency avg ms": Math.round(avg((r) => r.latencyMs)),
        "tokens in": runs.reduce((s, r) => s + r.inputTokens, 0),
        "tokens out": runs.reduce((s, r) => s + r.outputTokens, 0),
        "tool calls avg": fmt(avg((r) => r.toolCalls)),
        "model calls avg": fmt(avg((r) => r.modelCalls)),
        "jev routed": runs.filter((r) => r.route?.path === "router").length,
        "handoff rate": fmt(a.handoffRate),
        "offer rate": fmt(a.offerRate),
        "correct decision": fmt(a.correctDecision),
      };
    };
    const table: Record<string, ReturnType<typeof row>> = {};
    for (const [id, runs] of results) table[id] = row(runs);
    for (const [name, prefix] of Object.entries(GROUP_ROWS)) {
      const runs = [...results].filter(([id]) => id.startsWith(prefix)).flatMap(([, r]) => r);
      if (runs.length > 0) table[name] = row(runs);
    }
    table.TOTAL = row([...results.values()].flat());
    console.table(table);

    const all = [...results.values()].flat();
    const label = process.env.EVAL_LABEL ?? (all.some((r) => r.route?.path === "router") ? "jev-router" : "llm-loop");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    mkdirSync("eval-runs", { recursive: true });
    const file = `eval-runs/${stamp}-${label}.json`;
    writeFileSync(
      file,
      JSON.stringify(
        {
          label,
          at: new Date().toISOString(),
          promptVersion: PROMPT_VERSION,
          model: process.env.ANTHROPIC_MODEL ?? null,
          runsPerCase: RUNS,
          group: group ?? null,
          summary: table,
          cases: Object.fromEntries(results),
        },
        null,
        1,
      ),
    );
    console.info(`eval: saved ${file}`);
  });
});
