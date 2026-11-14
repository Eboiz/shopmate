// PB-30 photo eval with real Claude and the deployed photo search (Modal).
//
// The photo search only indexes the shared (cloud) Supabase project, so this
// eval runs the engine against that project, on the eval shop
// `hanh-boutique-eval` only. It creates one throwaway shopper + conversation,
// and deletes them (and their ai_turns) at the end. Photos are read from
// src/lib/engine/eval/photos/ instead of the chat-photos bucket, so the PB-30
// migration is not needed on the shared project (migrations reach it only after
// they are merged to main).
//
//   PHOTO_EVAL_SUPABASE_URL=https://<project>.supabase.co
//   PHOTO_EVAL_SUPABASE_SECRET_KEY=...        (the shared project's secret key)
//   EMBEDDER_URL=... EMBEDDER_TOKEN=...       (the Modal /search API)
//   ANTHROPIC_API_KEY=... [ANTHROPIC_API_URL=...]
//   EVAL_RUNS=3 pnpm engine:eval src/lib/engine/eval/photo.eval.ts
//
// Warm the Modal service first (curl -L $EMBEDDER_URL/health): the engine waits
// 15 s, then falls back to text search.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Database, TablesInsert } from "@/contract";
import { createDefaultModel } from "../anthropic-model";
import { runEngine } from "../engine";
import { FALLBACK_TEXT } from "../model-reply";
import { PROMPT_VERSION } from "../prompt";
import { createSupabaseStore, type EngineStore } from "../store";
import type { Db } from "../types";
import { PB30_CODES, pb30Cases } from "./cases-pb30";
import { aggregate, scoreRun, type ActualCall, type RunOutcome, type RunScore } from "./score";

const EVAL_SHOP = "hanh-boutique-eval";
const RUNS = Number(process.env.EVAL_RUNS ?? 3);
const env = process.env;
const ready = Boolean(
  env.PHOTO_EVAL_SUPABASE_URL && env.PHOTO_EVAL_SUPABASE_SECRET_KEY && env.EMBEDDER_URL && env.EMBEDDER_TOKEN && env.ANTHROPIC_API_KEY,
);
const PHOTO_DIR = path.resolve(__dirname, "photos");

// rawOutput: the model's last output when the engine could not read it (FALLBACK_TEXT).
type Run = { score: RunScore; calls: ActualCall[]; replyText: string; quickReplies: string[]; handoffReason: string | null; latencyMs: number; error?: string; rawOutput?: unknown };
const crashed = (error: unknown): Run => ({
  score: { passed: false, findsOk: null } as unknown as RunScore,
  calls: [], replyText: "", quickReplies: [], handoffReason: null, latencyMs: 0,
  error: error instanceof Error ? `${error.message}\n${error.stack?.split("\n").slice(0, 6).join("\n")}` : String(error),
});
const results = new Map<string, Run[]>();

describe.skipIf(!ready)("PB-30 photo eval (real Claude, Modal photo search, eval shop on the shared project)", () => {
  let db: Db;
  let store: EngineStore;
  let model: ReturnType<typeof createDefaultModel>;
  let shopId = "";
  let shopperId = "";
  let conversationId = "";
  let cases: ReturnType<typeof pb30Cases> = [];

  beforeAll(async () => {
    db = createClient<Database>(env.PHOTO_EVAL_SUPABASE_URL!, env.PHOTO_EVAL_SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const shop = await db.from("shops").select("id").eq("slug", EVAL_SHOP).single();
    if (shop.error) throw new Error(`photo eval: shop ${EVAL_SHOP} not found: ${shop.error.message}`);
    shopId = shop.data.id;
    const products = await db.from("products").select("id, code").eq("shop_id", shopId).in("code", [...PB30_CODES]);
    if (products.error) throw new Error(products.error.message);
    const ids = new Map(products.data.map((p) => [p.code, p.id]));
    for (const code of PB30_CODES) if (!ids.has(code)) throw new Error(`photo eval: ${code} missing in ${EVAL_SHOP}`);
    cases = pb30Cases((code) => ids.get(code)!);
    const filter = env.EVAL_CASE;
    if (filter) cases = cases.filter((c) => c.id === filter);

    const shopper = await db.from("shoppers")
      .insert({ shop_id: shopId, channel: "web", external_id: `photo-eval-${randomUUID()}` })
      .select("id").single();
    if (shopper.error) throw new Error(shopper.error.message);
    shopperId = shopper.data.id;
    const conversation = await db.from("conversations").insert({ shop_id: shopId, shopper_id: shopperId }).select("id").single();
    if (conversation.error) throw new Error(conversation.error.message);
    conversationId = conversation.data.id;

    model = createDefaultModel();
    const real = createSupabaseStore(db);
    // Photos from disk: a history's photoPaths are fixture file names.
    store = {
      ...real,
      loadPhotos: async (_shop, paths) =>
        paths.map((p) => ({ base64: readFileSync(path.join(PHOTO_DIR, path.basename(p))).toString("base64"), mediaType: "image/jpeg" as const })),
    };
  });

  afterAll(async () => {
    if (conversationId) {
      await db.from("ai_turns").delete().eq("conversation_id", conversationId).eq("shop_id", shopId);
      await db.from("messages").delete().eq("conversation_id", conversationId).eq("shop_id", shopId);
      await db.from("conversations").delete().eq("id", conversationId).eq("shop_id", shopId);
    }
    if (shopperId) await db.from("shoppers").delete().eq("id", shopperId).eq("shop_id", shopId);
    if (results.size === 0) return;

    const table: Record<string, { runs: number; passRate: string; findsOk: string; failed: string }> = {};
    for (const [id, runs] of results) {
      const a = aggregate(runs.map((r) => r.score));
      table[id] = {
        runs: runs.length,
        passRate: (a.passRate ?? 0).toFixed(2),
        findsOk: runs.some((r) => r.score.findsOk !== null) ? `${runs.filter((r) => r.score.findsOk).length}/${runs.length}` : "-",
        failed: runs.filter((r) => !r.score.passed).map((r) => (r.error ? "CRASH" : r.replyText.slice(0, 60))).join(" | "),
      };
    }
    console.table(table);
    mkdirSync("eval-runs", { recursive: true });
    const file = `eval-runs/${new Date().toISOString().replace(/[:.]/g, "-")}-photo.json`;
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), promptVersion: PROMPT_VERSION, runsPerCase: RUNS, summary: table, cases: Object.fromEntries(results) }, null, 1));
    console.info(`photo eval: saved ${file}`);
  });

  // The case list depends on the shop's ids, read in beforeAll: one test runs them all.
  it("runs every PB-30 case", { timeout: 180_000 * RUNS * 6 }, async () => {
    for (const c of cases) {
      const runs: Run[] = [];
      for (let i = 0; i < RUNS; i++) {
        await db.from("conversations").update({ mode: "ai" }).eq("id", conversationId).eq("shop_id", shopId);
        await db.from("ai_turns").delete().eq("conversation_id", conversationId).eq("shop_id", shopId);
        let row: TablesInsert<"ai_turns"> | null = null;
        let lastOutput: unknown = null;
        const capturing: EngineStore = { ...store, insertTurn: (r) => ((row = r), store.insertTurn(r)) };
        let result: Awaited<ReturnType<typeof runEngine>>;
        try {
          result = await runEngine(
            { mode: "customer", conversationId, history: c.history, productId: null },
            {
              model, db, store: capturing, jev: null, captureContent: true,
              onMetrics: (_m, detail) => void (lastOutput = detail?.calls.at(-1)?.output),
            },
          );
          await result.turnLogged;

        } catch (error) {
          console.error(`${c.id} run ${i + 1} crashed`, error);
          runs.push(crashed(error));
          continue;
        }
        const turn = row as TablesInsert<"ai_turns"> | null;
        if (!turn) throw new Error(`${c.id}: no ai_turns row`);
        const calls: ActualCall[] = ((turn.tool_calls ?? []) as { name: string; input: unknown; output?: unknown }[])
          .map((t) => ({ name: t.name, input: t.input, output: t.output }));
        const outcome: RunOutcome = {
          handoffReason: result.handoffReason,
          replyText: result.output.reply.text,
          handoffOffer: (turn.handoff_offer ?? null) as RunOutcome["handoffOffer"],
          quickReplies: result.output.reply.quickReplies,
        };
        const score = scoreRun(c, calls, outcome);
        if (!score.passed) console.info(`${c.id} failed:`, JSON.stringify({ calls: calls.map(({ name, input }) => ({ name, input })), ...outcome, score }));
        runs.push({
          score, calls, replyText: outcome.replyText, quickReplies: outcome.quickReplies ?? [],
          handoffReason: result.handoffReason, latencyMs: turn.latency_ms,
          ...(outcome.replyText === FALLBACK_TEXT ? { rawOutput: lastOutput } : {}),
        });
      }
      results.set(c.id, runs);
    }
  });
});
