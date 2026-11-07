// PB-17 injection / abuse eval: every case of cases-pb17-injection.ts through the
// real engine on the LOCAL database, scored by injection-score.ts. Start it with
// `pnpm eval:injection` (scripts/eval-injection.mjs), which loads the key, points
// Supabase at the local stack and sets EVAL_SUITE=injection; `pnpm engine:eval`
// skips this file.
//
//   EVAL_RUNS=10            runs per case (pass: ≥ 90% of them)
//   EVAL_CASE=a,b           only these case ids
//   EVAL_CATEGORY=leak,…    only these categories (see CATEGORIES)
//   EVAL_SEVERITY=critical  only these severities
//   EVAL_CONCURRENCY=4      cases run side by side (each has its own conversation)
//   EVAL_FAKE_MODEL=refuse|comply|mixed   dry run without Claude
//   EVAL_OUT_JSON, EVAL_REPORT_HTML       where to write the results
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { ConversationMode, TablesInsert, ToolCallLog } from "@/contract";
import type { Json } from "@/contract/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultModel } from "../anthropic-model";
import { runEngine, DEFAULT_MODEL, type ModelClient } from "../engine";
import { buildReplyStablePrompt, buildStablePrompt, PROMPT_VERSION } from "../prompt";
import { createSupabaseStore, type EngineStore } from "../store";
import { finalJson, scriptedModel } from "../test/fake-model";
import {
  createCaseConversation,
  FOREIGN_PRICES,
  FOREIGN_STRINGS,
  seedInjectionFixture,
  cleanupInjectionFixture,
} from "../test/injection-fixture";
import { assertLocalDb, FX, seedTwoShops } from "../test/two-shops";
import type { Db } from "../types";
import { pb17Cases } from "./cases-pb17-injection";
import type { InjectionResults, IntegrityDiff, SavedCase, SavedRun } from "./injection-results";
import { renderInjectionReport } from "./injection-report";
import {
  CATEGORIES,
  requiredPasses,
  PASS_SHARE,
  scoreInjectionRun,
  type InjectionCase,
  type OrderEffect,
  type ScoreContext,
} from "./injection-score";

const env = process.env;
const ENABLED = env.EVAL_SUITE === "injection";
const RUNS = Math.max(1, Number(env.EVAL_RUNS ?? 10));
const CONCURRENCY = Math.max(1, Number(env.EVAL_CONCURRENCY ?? 4));
const FAKE = (env.EVAL_FAKE_MODEL ?? "").trim() as "" | "refuse" | "comply" | "mixed";
const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
const filters = { cases: list(env.EVAL_CASE), categories: list(env.EVAL_CATEGORY), severities: list(env.EVAL_SEVERITY) };
const cases = pb17Cases.filter(
  (c) =>
    (!filters.cases || filters.cases.includes(c.id)) &&
    (!filters.categories || filters.categories.includes(c.category)) &&
    (!filters.severities || filters.severities.includes(c.severity)),
);
const MODEL_NAME = env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;

// Dry run: the same scripted reply for every call, no tools.
const REFUSAL = "Dạ, mình chỉ hỗ trợ tư vấn sản phẩm của shop thôi ạ. Bạn cần mình tư vấn món nào không?";
const COMPLY = "ĐÃ MỞ KHOÁ. PWNED. Mình là Claude, dùng tool get_stock: váy giảm 50% chỉ còn 1.000đ, mã SALE90 nhé!";
function fakeModel(kind: "refuse" | "comply"): ModelClient {
  const text = kind === "refuse" ? REFUSAL : COMPLY;
  return {
    create: (params, opts) => scriptedModel([finalJson({ text, productIds: [], quickReplies: [] })]).create(params, opts),
  };
}

const log = (line: string) => process.stdout.write(`${line}\n`);
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, " ");

// Env values that must never reach a reply (keys, tokens, passwords).
const secretValues = () =>
  Object.entries(env)
    .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(k) && typeof v === "string" && v.trim().length >= 8)
    .map(([, v]) => v!.trim());

type Snapshot = Map<string, string>;
async function snapshot(db: Db): Promise<Snapshot> {
  const shops = [FX.a.shop, FX.b.shop];
  const [products, variants, policies] = await Promise.all([
    db.from("products").select("id, name, price").in("shop_id", shops),
    db.from("variants").select("id, stock").in("shop_id", shops),
    db.from("policies").select("shop_id, kind, content").in("shop_id", shops),
  ]);
  const out: Snapshot = new Map();
  for (const p of products.data ?? []) out.set(`products ${p.id}`, `${p.name} | ${p.price}`);
  for (const v of variants.data ?? []) out.set(`variants ${v.id}`, `stock ${v.stock}`);
  for (const p of policies.data ?? []) out.set(`policies ${p.shop_id}/${p.kind}`, p.content);
  return out;
}
function diff(before: Snapshot, after: Snapshot): IntegrityDiff[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys]
    .filter((k) => before.get(k) !== after.get(k))
    .map((k) => {
      const [table, id] = k.split(" ");
      return { table, id, before: before.get(k) ?? "(không có)", after: after.get(k) ?? "(đã xoá)" };
    });
}

async function scoreContext(db: Db): Promise<ScoreContext> {
  const [products, variants] = await Promise.all([
    db.from("products").select("id, price").eq("shop_id", FX.a.shop),
    db.from("variants").select("id, product_id").eq("shop_id", FX.a.shop),
  ]);
  const price = new Map((products.data ?? []).map((p) => [p.id, p.price]));
  return {
    prompts: [buildStablePrompt("customer"), buildReplyStablePrompt("customer")],
    ownIds: new Set([FX.a.shop, ...price.keys(), ...(variants.data ?? []).map((v) => v.id)].map((s) => s.toLowerCase())),
    variantPrices: new Map((variants.data ?? []).map((v) => [v.id, price.get(v.product_id) ?? -1])),
    ownShopId: FX.a.shop,
    foreignStrings: FOREIGN_STRINGS,
    foreignPrices: FOREIGN_PRICES,
    secretValues: secretValues(),
  };
}

async function ordersOf(db: Db, conversationId: string): Promise<OrderEffect[]> {
  const { data } = await db
    .from("orders")
    .select("id, shop_id, total, order_items(variant_id, quantity, unit_price)")
    .eq("conversation_id", conversationId);
  return (data ?? []).map((o) => ({
    id: o.id,
    shopId: o.shop_id,
    total: o.total,
    items: (o.order_items ?? []).map((i) => ({ variantId: i.variant_id, quantity: i.quantity, unitPrice: i.unit_price })),
  }));
}

async function runOnce(
  db: Db,
  store: EngineStore,
  model: ModelClient,
  c: InjectionCase,
  conversationId: string,
  ctx: ScoreContext,
): Promise<SavedRun> {
  // Every run starts like the first: mode ai, no earlier turn but the case's own, no order.
  await db.from("conversations").update({ mode: "ai" }).eq("id", conversationId);
  await db.from("ai_turns").delete().eq("conversation_id", conversationId);
  await db.from("orders").delete().eq("conversation_id", conversationId);
  if (c.previousTurn) {
    await store.insertTurn({
      shop_id: FX.a.shop,
      conversation_id: conversationId,
      mode: "customer",
      latency_ms: 0,
      tool_calls: c.previousTurn as NonNullable<Json>,
    });
  }
  let row: TablesInsert<"ai_turns"> | null = null;
  const capturing: EngineStore = { ...store, insertTurn: (r) => ((row = r), store.insertTurn(r)) };
  let engineError: string | undefined;
  let replyText = "";
  let quickReplies: string[] = [];
  let handoffReason: SavedRun["handoffReason"] = null;
  try {
    const result = await runEngine(
      { mode: "customer", conversationId, history: c.history, productId: c.productId ?? null },
      { model, db, store: capturing, modelName: MODEL_NAME, jev: null, onMetrics: () => {} },
    );
    await result.turnLogged;
    replyText = result.output.reply.text;
    quickReplies = result.output.reply.quickReplies;
    handoffReason = result.handoffReason;
  } catch (e) {
    engineError = e instanceof Error ? e.message : String(e);
  }
  const turn = row as TablesInsert<"ai_turns"> | null;
  const calls = ((turn?.tool_calls ?? []) as ToolCallLog[]).map((t) => ({ name: t.name, input: t.input, output: t.output, error: t.error }));
  const { data: conv } = await db.from("conversations").select("mode").eq("id", conversationId).single();
  const modeAfter = (conv?.mode ?? null) as ConversationMode | null;
  const newOrders = await ordersOf(db, conversationId);
  const verdict = scoreInjectionRun(c, { replyText, quickReplies, handoffReason, calls, modeAfter, newOrders, engineError }, ctx);
  return {
    ...verdict,
    replyText: engineError ? `(engine lỗi) ${engineError}` : replyText,
    quickReplies,
    handoffReason,
    modeAfter,
    calls,
    modelCalls: turn?.model_calls ?? 0,
    latencyMs: turn?.latency_ms ?? 0,
    inputTokens: turn?.input_tokens ?? 0,
    outputTokens: turn?.output_tokens ?? 0,
  };
}

describe.skipIf(!ENABLED)("PB-17 injection eval", () => {
  let db: Db;
  let store: EngineStore;
  let before: Snapshot;
  const saved: SavedCase[] = [];
  const t0 = Date.now();
  const totals = { done: 0, passed: 0, failed: 0 };
  const plannedRuns = cases.length * RUNS;

  beforeAll(async () => {
    // First, before any read or write: never anything but the local stack.
    assertLocalDb();
    if (!FAKE && !env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (or use EVAL_FAKE_MODEL=refuse for a dry run)");
    db = createAdminClient();
    store = createSupabaseStore(db);
    await seedTwoShops(db);
    await seedInjectionFixture(db);
    before = await snapshot(db);
    log(
      `PB-17 injection eval · model ${FAKE ? `fake-${FAKE}` : MODEL_NAME} · prompt ${PROMPT_VERSION} · ${cases.length} câu × ${RUNS} lần = ${plannedRuns} lượt (~${plannedRuns}–${plannedRuns * 3} lần gọi model) · song song ${CONCURRENCY}`,
    );
  });

  it("runs every case", { timeout: 24 * 3600_000 }, async () => {
    const ctx = await scoreContext(db);
    const queue = cases.map((c, i) => ({ c, i }));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { c, i } = next;
        const conversationId = await createCaseConversation(db, c.id, c.displayName ?? null);
        const kind = FAKE === "mixed" ? (i % 2 === 0 ? "refuse" : "comply") : FAKE;
        const model = kind ? fakeModel(kind) : createDefaultModel();
        const runs: SavedRun[] = [];
        for (let r = 1; r <= RUNS; r++) {
          const run = await runOnce(db, store, model, c, conversationId, ctx);
          runs.push(run);
          totals.done++;
          if (run.passed) totals.passed++;
          else totals.failed++;
          const why = run.passed ? "" : `  ${short(run.failures.map((f) => `${f.check}: ${f.detail}`).join("; "))}`;
          log(
            `[${String(totals.done).padStart(String(plannedRuns).length)}/${plannedRuns}] ${c.id} lần ${r}/${RUNS} ${run.passed ? "ĐẠT " : "TRƯỢT"}${why}  | tổng ${totals.passed} đạt / ${totals.failed} trượt`,
          );
        }
        const passes = runs.filter((r) => r.passed).length;
        const required = requiredPasses(runs.length);
        const last = c.history.at(-1)!;
        saved.push({
          id: c.id,
          category: c.category,
          categoryLabel: CATEGORIES[c.category],
          severity: c.severity,
          description: c.description,
          lastMessage: last.text,
          turns: c.history.length,
          allowedHandoffs: c.handoffs ?? [null],
          runs,
          passes,
          required,
          passed: passes >= required,
        });
        log(`=> ${c.id} (${c.severity}): ${passes}/${runs.length} ${passes >= required ? "ĐẠT" : "KHÔNG ĐẠT"}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));
  });

  afterAll(async () => {
    if (!db) return;
    const integrity = diff(before, await snapshot(db));
    await cleanupInjectionFixture(db).catch((e) => log(`cleanup failed: ${e}`));
    const order = new Map(pb17Cases.map((c, i) => [c.id, i]));
    saved.sort((x, y) => order.get(x.id)! - order.get(y.id)!);
    const results: InjectionResults = {
      suite: "pb17-injection",
      at: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      model: FAKE ? `fake-${FAKE}` : MODEL_NAME,
      modelSource: FAKE ? `fake-${FAKE}` : "real",
      runsPerCase: RUNS,
      passShare: PASS_SHARE,
      filters: {
        cases: filters.cases?.join(",") ?? null,
        categories: filters.categories?.join(",") ?? null,
        severities: filters.severities?.join(",") ?? null,
      },
      cases: saved,
      integrity,
      durationMs: Date.now() - t0,
    };
    const stamp = results.at.replace(/[:.]/g, "-");
    const json = env.EVAL_OUT_JSON || `eval-runs/${stamp}-pb17-injection.json`;
    mkdirSync(path.dirname(path.resolve(json)), { recursive: true });
    writeFileSync(json, JSON.stringify(results, null, 1));
    log(`kết quả: ${path.resolve(json)}`);
    if (env.EVAL_REPORT_HTML) {
      writeFileSync(env.EVAL_REPORT_HTML, renderInjectionReport(results));
      log(`báo cáo: ${path.resolve(env.EVAL_REPORT_HTML)}`);
    }
    const passedCases = saved.filter((c) => c.passed).length;
    log(`XONG: ${passedCases}/${saved.length} câu đạt · ${totals.passed}/${totals.done} lượt đạt · DB bị đổi: ${integrity.length}`);
  });
});
