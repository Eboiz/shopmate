// Acceptance run of the AI against a DEPLOYED web chat (production by default),
// the way a shopper uses it: POST /api/shops/<slug>/chat without a cookie (a new
// shopper), keep the cookie for follow-up turns, read the history back. Each turn
// is then checked against the database: the ai_turns row (tools, handoff_reason,
// model, prompt version), orders and stock. READ ONLY: this script never writes
// to the database, and only reads rows of conversations it created.
//
//   pnpm eval:live --plan                        cases, groups, new shoppers, tokens; no request
//   pnpm eval:live --group 1                     one budget group (<= 20 new shoppers), 3 runs each
//   EVAL_ISSUE=PB-06 pnpm eval:live              one issue (comma list allowed)
//   EVAL_CASE=pb05-soldout EVAL_RUNS=1 pnpm eval:live
//   pnpm eval:live --group 2 --wait              wait (countdown) until the hourly budget allows the group
//   pnpm eval:live --compare eval-runs/<file>.json   comparison table in the report
//   pnpm eval:live --fake                        replay the bundled fixture: no network, no Claude
//   pnpm eval:live --report-only eval-runs/<file>.json [--compare <json>] [--out <html>]
//
// Options: --base <url> (default https://shopmate-beige.vercel.app), --shop <slug>
// (default may-boutique-eval; a shop without the -eval suffix needs --allow-demo-shop),
// --out <html> (default ../Bao cao kiem thu AI production <dd-mm>.html next to the repo).
//
// Production limits per client IP (src/lib/guard/web-chat-limit.ts): 20 new shoppers
// per hour, 15 messages per minute in one shop. The runner sends at most 12 a minute,
// 4 s apart, counts new shoppers in eval-runs/.live-new-shoppers.json, and refuses
// (or waits with --wait) when a plan doesn't fit the hour. HTTP 429/5xx or the engine
// failure notice is an infra error, not an AI failure; two in a row stop the run.
//
// Database: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the shell, else
// .env.local (only these two are read from the file). They must be the project the
// deployment uses.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/contract/database.types.ts";
import { caseData, liveCases, type LiveCase } from "../src/lib/engine/eval/live-cases.ts";
import { replayTransport } from "../src/lib/engine/eval/live-fake.ts";
import { formatCountdown, groupTotals, hourlyBudget, HOUR, LIMITS, planRows, planTotals } from "../src/lib/engine/eval/live-pacing.ts";
import { renderLiveReport } from "../src/lib/engine/eval/live-report.ts";
import { issueVerdicts, totals } from "../src/lib/engine/eval/live-results.ts";
import { memoryLedger, PlanRefused, runLive, virtualClock, type Clock, type Ledger, type Session, type Transport } from "../src/lib/engine/eval/live-runner.ts";
import {
  RESULTS_KIND,
  type AiTurn,
  type LiveResults,
  type OrderRecord,
  type ShopReply,
  type ShopSnapshot,
  type TurnRecord,
} from "../src/lib/engine/eval/live-types.ts";

const root = path.resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "https://shopmate-beige.vercel.app" },
    shop: { type: "string", default: "may-boutique-eval" },
    "allow-demo-shop": { type: "boolean" },
    plan: { type: "boolean" },
    group: { type: "string" },
    out: { type: "string" },
    compare: { type: "string" },
    fake: { type: "boolean" },
    fixture: { type: "string" },
    wait: { type: "boolean" },
    "report-only": { type: "string" },
  },
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const today = new Date();
const ddmm = `${String(today.getDate()).padStart(2, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}`;
// Next to the shopmate folder: C:\Bach_Khoa\Final_Year\CNPMNC\Bao cao kiem thu AI production dd-mm.html
const htmlOut = path.resolve(args.out ?? path.join(root, "..", `Bao cao kiem thu AI production ${ddmm}.html`));
const readResults = (file: string): LiveResults => {
  const data = JSON.parse(readFileSync(file, "utf8")) as LiveResults;
  if (data.kind !== RESULTS_KIND) fail(`${file} không phải file kết quả của eval:live`);
  return data;
};
const previous = args.compare ? readResults(args.compare) : null;

if (args["report-only"]) {
  writeFileSync(htmlOut, renderLiveReport(readResults(args["report-only"]), previous));
  console.info(`báo cáo: ${htmlOut}`);
  process.exit(0);
}

// ---------- cases ----------
const runs = Number(process.env.EVAL_RUNS ?? 3);
if (!Number.isInteger(runs) || runs < 1) fail(`EVAL_RUNS=${process.env.EVAL_RUNS}: cần số nguyên ≥ 1`);
const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const caseFilter = list(process.env.EVAL_CASE);
const issueFilter = list(process.env.EVAL_ISSUE).map((s) => s.toUpperCase());
const group = args.group === undefined ? null : Number(args.group);
if (group !== null && !liveCases.some((c) => c.group === group)) fail(`--group ${args.group}: không có nhóm này (xem --plan)`);
for (const id of caseFilter) if (!liveCases.some((c) => c.id === id)) fail(`EVAL_CASE: không có case ${id}`);
const cases: LiveCase[] = liveCases.filter(
  (c) =>
    (group === null || c.group === group) &&
    (caseFilter.length === 0 || caseFilter.includes(c.id)) &&
    (issueFilter.length === 0 || issueFilter.includes(c.issue)),
);
if (cases.length === 0) fail("Không còn case nào sau khi lọc");

// ---------- the new-shopper ledger (per deployment, this machine) ----------
const ledgerFile = path.join(root, "eval-runs", ".live-new-shoppers.json");
const ledgerKey = new URL(args.base).host;
function fileLedger(): Ledger {
  let all: Record<string, number[]> = {};
  try {
    all = JSON.parse(readFileSync(ledgerFile, "utf8"));
  } catch {
    all = {};
  }
  const times = (all[ledgerKey] ?? []).filter((t) => Date.now() - t < HOUR);
  return {
    times: () => times,
    add(t) {
      times.push(t);
      mkdirSync(path.dirname(ledgerFile), { recursive: true });
      writeFileSync(ledgerFile, JSON.stringify({ ...all, [ledgerKey]: times }));
    },
  };
}

// ---------- --plan ----------
if (args.plan) {
  const rows = planRows(cases, runs);
  const t = planTotals(rows);
  console.info(`Kế hoạch eval:live · ${args.base} · shop ${args.shop} · EVAL_RUNS=${runs}${group !== null ? ` · nhóm ${group}` : ""}`);
  console.table(Object.fromEntries(rows.map((r) => [r.id, { issue: r.issue, nhóm: r.group, "tin/lần": r.turns, lần: r.runs, "khách mới": r.newShoppers, tin: r.messages, "token ~": r.tokens }])));
  console.table(Object.fromEntries(groupTotals(cases, runs).map((g) => [`nhóm ${g.group}`, { case: g.cases, "khách mới": g.newShoppers, tin: g.messages, "token ~": g.tokens, "phút ~": g.minutes }])));
  console.info(`Tổng: ${t.cases} case, ${t.newShoppers} khách mới, ${t.messages} tin, ~${t.tokens.toLocaleString("vi-VN")} token (ước lượng thô, như #53), ~${t.minutes} phút.`);
  const { remaining } = hourlyBudget(fileLedger().times(), Date.now());
  console.info(`Giới hạn production: ${LIMITS.newShoppersPerHour} khách mới/giờ/IP. Máy này còn ${remaining}/${LIMITS.newShoppersPerHour} trong giờ hiện tại.`);
  if (t.newShoppers > LIMITS.newShoppersPerHour) console.info("Kế hoạch vượt 20 khách mới: chạy từng nhóm, cách nhau 1 giờ (--group 1, rồi --group 2, ...).");
  process.exit(0);
}

// ---------- shop guard ----------
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.shop)) fail(`--shop ${args.shop}: slug không hợp lệ`);
if (!args.shop.endsWith("-eval") && !args["allow-demo-shop"]) {
  fail(`--shop ${args.shop} là shop thật (demo của PO, có kênh chat). Dùng shop -eval, hoặc thêm --allow-demo-shop nếu thật sự muốn.`);
}

// ---------- fake: replay a recorded results file ----------
async function fakeSetup(): Promise<{ snapshot: ShopSnapshot; transport: Transport; clock: Clock; ledger: Ledger }> {
  const file = args.fixture ?? path.join(root, "src", "lib", "engine", "eval", "fixtures", "live-fake.json");
  const recorded = readResults(file);
  const clock = virtualClock(Date.now());
  return { snapshot: recorded.snapshot, transport: replayTransport(recorded, clock), clock, ledger: memoryLedger() };
}

// ---------- live: HTTP to the deployment + read-only database ----------
function readEnv(): { url: string; key: string } {
  const file = path.join(root, ".env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const pick = (name: string) => process.env[name]?.trim() || fromFile[name]?.trim() || "";
  const url = pick("NEXT_PUBLIC_SUPABASE_URL");
  const key = pick("SUPABASE_SECRET_KEY");
  if (!url || !key) fail("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SECRET_KEY (trong .env.local hoặc shell): cần để đọc ai_turns, đơn và tồn kho.");
  return { url, key };
}

async function liveSetup(): Promise<{ snapshot: ShopSnapshot; transport: Transport; clock: Clock; ledger: Ledger }> {
  const { url, key } = readEnv();
  // Only .select() is ever called on this client.
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const must = <T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as NonNullable<T>;
  };

  const shop = must(await db.from("shops").select("id, name, slug").eq("slug", args.shop).maybeSingle(), "shops");
  if (!shop) fail(`Không có shop ${args.shop} trong database ${url}`);
  const [products, pairings, policies] = await Promise.all([
    db.from("products").select("id, code, name, price, description, variants(id, size, color, stock), size_charts(size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)").eq("shop_id", shop.id),
    db.from("pairings").select("product_a_id, product_b_id, reason").eq("shop_id", shop.id),
    db.from("policies").select("kind, content").eq("shop_id", shop.id),
  ]);
  const policy = (kind: string) => must(policies, "policies").find((p) => p.kind === kind)?.content.trim() ?? "";
  const snapshot: ShopSnapshot = {
    shopId: shop.id,
    slug: shop.slug,
    name: shop.name,
    products: must(products, "products").map((p) => ({
      id: p.id, code: p.code, name: p.name, price: p.price, description: p.description,
      variants: p.variants.map((v) => ({ id: v.id, size: v.size, color: v.color, stock: v.stock })),
      sizeChart: p.size_charts,
    })),
    pairings: must(pairings, "pairings").map((x) => ({ productA: x.product_a_id, productB: x.product_b_id, reason: x.reason })),
    policies: { doi_tra: policy("doi_tra"), giao_hang: policy("giao_hang"), khuyen_mai: policy("khuyen_mai") },
  };

  const chatUrl = `${args.base.replace(/\/$/, "")}/api/shops/${args.shop}/chat`;
  const seenTurns = new Map<Session, Set<string>>();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // The conversation of this cookie: shoppers.external_id is the SHA-256 of the token (web-chat.ts).
  async function conversationOf(cookie: string): Promise<string | null> {
    const externalId = createHash("sha256").update(cookie).digest("base64url");
    const shopper = must(await db.from("shoppers").select("id").eq("shop_id", shop!.id).eq("channel", "web").eq("external_id", externalId).maybeSingle(), "shoppers");
    if (!shopper) return null;
    const conv = must(await db.from("conversations").select("id").eq("shop_id", shop!.id).eq("shopper_id", shopper.id).maybeSingle(), "conversations");
    return conv?.id ?? null;
  }
  async function newAiTurn(session: Session, wait: boolean): Promise<AiTurn | null> {
    const seen = seenTurns.get(session) ?? new Set<string>();
    seenTurns.set(session, seen);
    // ai_turns is written in after(), a moment after the response.
    for (let i = 0; i < (wait ? 15 : 1); i++) {
      const rows = must(
        await db.from("ai_turns")
          .select("id, created_at, tool_calls, handoff_reason, model, prompt_version, latency_ms, input_tokens, output_tokens")
          .eq("shop_id", shop!.id).eq("conversation_id", session.conversationId!).order("created_at"),
        "ai_turns",
      );
      const fresh = rows.filter((r) => !seen.has(r.id));
      if (fresh.length) {
        fresh.forEach((r) => seen.add(r.id));
        const r = fresh.at(-1)!;
        return {
          id: r.id, createdAt: r.created_at, toolCalls: (r.tool_calls ?? []) as AiTurn["toolCalls"], handoffReason: r.handoff_reason,
          model: r.model, promptVersion: r.prompt_version, latencyMs: r.latency_ms, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
        };
      }
      if (wait) await sleep(1000);
    }
    return null;
  }
  async function orders(conversationId: string): Promise<OrderRecord[]> {
    const rows = must(
      await db.from("orders").select("id, status, total, customer_name, customer_phone, customer_address, order_items(variant_id, quantity, unit_price, line_total)")
        .eq("shop_id", shop!.id).eq("conversation_id", conversationId),
      "orders",
    );
    return rows.map((o) => ({
      id: o.id, status: o.status, total: o.total, customerName: o.customer_name, customerPhone: o.customer_phone, customerAddress: o.customer_address,
      items: o.order_items.map((i) => ({ variantId: i.variant_id, quantity: i.quantity, unitPrice: i.unit_price, lineTotal: i.line_total })),
    }));
  }

  const transport: Transport = {
    async turn(session, text, productId) {
      const t0 = Date.now();
      const base: TurnRecord = { shopper: text, productId, httpStatus: null, status: null, error: null, wallMs: 0, replies: [], aiTurn: null, modeAfter: null };
      let res: Response;
      try {
        res = await fetch(chatUrl, {
          method: "POST",
          headers: { "content-type": "application/json", ...(session.cookie ? { cookie: `shopmate_shopper=${session.cookie}` } : {}) },
          body: JSON.stringify({ text, productId, clientMessageId: randomUUID() }),
          signal: AbortSignal.timeout(130_000),
        });
      } catch (e) {
        return { ...base, wallMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
      }
      const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      const turn: TurnRecord = { ...base, httpStatus: res.status, status: body.status ?? null, error: body.error ?? null, wallMs: Date.now() - t0 };
      for (const c of res.headers.getSetCookie()) {
        const m = /^shopmate_shopper=([^;]+)/.exec(c);
        if (m) session.cookie = m[1];
      }
      if (!session.cookie) return turn;
      session.conversationId ??= await conversationOf(session.cookie);
      if (!res.ok || !session.conversationId) return turn;

      // The shop's messages after this shopper message, as the chat shows them.
      const history = await fetch(chatUrl, { headers: { cookie: `shopmate_shopper=${session.cookie}` } });
      const { messages = [] } = (await history.json().catch(() => ({}))) as {
        messages?: { sender: string; text: string; reply: { text: string; products: ShopReply["products"]; quickReplies: string[] } | null }[];
      };
      const lastShopper = messages.findLastIndex((m) => m.sender === "shopper");
      turn.replies = messages.slice(lastShopper + 1).filter((m) => m.sender !== "shopper").map((m) => ({
        sender: m.sender as ShopReply["sender"],
        text: m.reply?.text ?? m.text,
        products: (m.reply?.products ?? []).map((p) => ({ productId: p.productId, name: p.name, price: p.price, sizesInStock: p.sizesInStock })),
        quickReplies: m.reply?.quickReplies ?? [],
      }));
      turn.aiTurn = await newAiTurn(session, turn.status === "answered" || turn.status === "handed_off");
      const conv = must(await db.from("conversations").select("mode").eq("id", session.conversationId).eq("shop_id", shop!.id).single(), "mode");
      turn.modeAfter = conv.mode;
      return turn;
    },
    async hasOrder(session) {
      return session.conversationId ? (await orders(session.conversationId)).length > 0 : false;
    },
    async finish(session, watch) {
      const stockAfter: Record<string, number> = {};
      if (watch.length) {
        const rows = must(await db.from("variants").select("id, stock").eq("shop_id", shop!.id).in("id", watch), "variants");
        for (const r of rows) stockAfter[r.id] = r.stock;
      }
      return { orders: await orders(session.conversationId!), stockAfter };
    },
  };
  return { snapshot, transport, clock: { now: () => Date.now(), sleep }, ledger: fileLedger() };
}

// ---------- run ----------
const fake = args.fake === true;
console.info(
  `${fake ? "CHẠY THỬ --fake (không gọi mạng)" : `Production: ${args.base}`} · shop ${args.shop} · EVAL_RUNS=${runs} · ${cases.length} case${group !== null ? ` · nhóm ${group}` : ""} · báo cáo: ${htmlOut}`,
);
const setup = fake ? await fakeSetup() : await liveSetup();
const skipped = cases.filter((c) => c.precondition?.(caseData(setup.snapshot, c)));
for (const c of skipped) console.info(`! ${c.id}: bỏ qua, ${c.precondition!(caseData(setup.snapshot, c))}`);

let results: LiveResults;
try {
  results = await runLive({
    cases,
    runs,
    snapshot: setup.snapshot,
    transport: setup.transport,
    clock: setup.clock,
    ledger: setup.ledger,
    log: (line) => console.info(line),
    wait: args.wait === true,
    enforceBudget: !fake,
    meta: { base: args.base, shop: args.shop, group, filters: { case: caseFilter.join(",") || null, issue: issueFilter.join(",") || null }, fake },
  });
} catch (e) {
  if (e instanceof PlanRefused) fail(e.message);
  throw e;
}

mkdirSync(path.join(root, "eval-runs"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonOut = path.join(root, "eval-runs", `${stamp}-live-${args.shop}${group !== null ? `-g${group}` : ""}${fake ? "-fake" : ""}.json`);
writeFileSync(jsonOut, JSON.stringify(results, null, 1));
writeFileSync(htmlOut, renderLiveReport(results, previous));

const t = totals(results);
console.info(`\nKết quả: ${t.pass} đạt · ${t.fail} trượt · ${t.infra} lỗi hạ tầng · ${t.skip} bỏ qua · ${t.tokens.toLocaleString("vi-VN")} token (ai_turns)`);
for (const v of issueVerdicts(results)) console.info(`  ${v.issue}: ${v.verdict === "pass" ? "ĐẠT" : v.verdict === "fail" ? "KHÔNG ĐẠT" : "CHƯA KẾT LUẬN"} (${v.pass}/${v.scored} lượt đạt${v.infra ? `, ${v.infra} lỗi hạ tầng` : ""})`);
if (!fake) {
  const { remaining } = hourlyBudget(setup.ledger.times(), Date.now());
  const next = setup.ledger.times().length ? Math.min(...setup.ledger.times()) + HOUR - Date.now() : 0;
  console.info(`Còn ${remaining}/${LIMITS.newShoppersPerHour} khách mới trong giờ này${remaining < LIMITS.newShoppersPerHour ? ` (slot đầu tiên mở lại sau ${formatCountdown(Math.max(0, next))})` : ""}.`);
}
console.info(`kết quả: ${jsonOut}\nbáo cáo: ${htmlOut}`);
