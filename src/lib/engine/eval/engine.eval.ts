// Labeled eval of the engine with real Claude (pnpm engine:eval). Informational
// only: it never fails on a low score; thresholds come once there is a baseline.
//
//   EVAL_RUNS=3 (default)   runs per case
//   EVAL_CASE=<id>          run one case only
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { TablesInsert } from "@/contract";
import type { Json } from "@/contract/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicModel } from "../anthropic-model";
import { runEngine } from "../engine";
import { createSupabaseStore, type EngineStore } from "../store";
import { assertLocalDb, FX, seedTwoShops } from "../test/two-shops";
import type { Db } from "../types";
import { evalCases } from "./cases";
import { pb05EvalCases } from "./cases-pb05";
import { aggregate, scoreRun, type ActualCall, type RunScore } from "./score";

const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const allCases = [...evalCases, ...pb05EvalCases];
const cases = process.env.EVAL_CASE ? allCases.filter((c) => c.id === process.env.EVAL_CASE) : allCases;

type Run = { score: RunScore; latencyMs: number; inputTokens: number; outputTokens: number; toolCalls: number };
const results = new Map<string, Run[]>();

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("engine eval (real Claude)", () => {
  let db: Db;
  let store: EngineStore;
  let model: ReturnType<typeof createAnthropicModel>;

  beforeAll(async () => {
    assertLocalDb();
    model = createAnthropicModel(new Anthropic());
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
        const capturing: EngineStore = {
          ...store,
          insertTurn: (r) => {
            row = r;
            return store.insertTurn(r);
          },
        };
        const result = await runEngine(
          { mode: "customer", conversationId: FX.a.conversation, history: c.history, productId: c.productId ?? null },
          { model, db, store: capturing, onMetrics: () => {} },
        );
        await result.turnLogged;
        const turn = row as TablesInsert<"ai_turns"> | null;
        if (!turn) throw new Error(`${c.id}: no ai_turns row`);
        const calls: ActualCall[] = ((turn.tool_calls ?? []) as { name: string; input: unknown }[]).map((t) => ({
          name: t.name,
          input: t.input,
        }));
        const outcome = { handoffReason: result.handoffReason, replyText: result.output.reply.text };
        const score = scoreRun(c, calls, outcome);
        if (!score.passed) console.info(`${c.id} failed:`, JSON.stringify({ calls, ...outcome, score }));
        runs.push({
          score,
          latencyMs: turn.latency_ms,
          inputTokens: turn.input_tokens ?? 0,
          outputTokens: turn.output_tokens ?? 0,
          toolCalls: calls.length,
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
      };
    };
    const table: Record<string, ReturnType<typeof row>> = {};
    for (const [id, runs] of results) table[id] = row(runs);
    table.TOTAL = row([...results.values()].flat());
    console.table(table);
  });
});
