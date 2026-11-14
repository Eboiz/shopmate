// Replays labeled shopper conversations through the real web chat API and grades
// each reply. Usage (from the repo root):
//   node [--env-file=.env.local] .claude/skills/testing-chat-pipeline/replay.mjs \
//     --base http://localhost:3000 [--runs 3] [--case <id>] [--label <name>] \
//     [--cases <file>] [--resume <results.json>] [--no-db]
// Each run of a case is a new shopper (new cookie). With NEXT_PUBLIC_SUPABASE_URL
// and SUPABASE_SECRET_KEY of the SAME database as --base, it also reads ai_turns
// (tools, handoff reason, latency, prompt version) for every turn.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Quick replies naming a garment must match a product of the shop (spec F2).
const GARMENT = ["ao", "vay", "dam", "quan", "khoac", "so mi", "somi", "blazer", "bomber", "cardigan", "gile", "jean", "jacket", "hoodie", "croptop"];
const STOP = new Set(["xem", "dat", "tim", "lai", "mua", "them", "khac", "cho", "minh", "toi", "size", "mau", "nhe", "hoi", "gi", "nao", "con", "khong", "loai"]);

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.base) exit("missing --base <url> (local dev server or the PR's Vercel preview)");
const base = args.base.replace(/\/$/, "");
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);
const spec = JSON.parse(readFileSync(args.cases ?? path.join(here, "cases.json"), "utf8"));
const shop = args.shop ?? spec.shop;
const runs = Number(args.runs ?? 3);
const cases = spec.cases.filter((c) => !args.case || c.id === args.case);
if (cases.length === 0) exit(`no case with id ${args.case}`);
const label = args.label ?? (local ? "local" : "preview");
const out = args.out ?? path.join("replay-runs", `${new Date().toISOString().slice(0, 10)}-${label}.json`);
const previous = args.resume ? JSON.parse(readFileSync(args.resume, "utf8")).results : [];
const done = new Set(previous.filter((r) => !r.harnessError).map((r) => `${r.case}#${r.run}`));
const db = args["no-db"] ? null : await openDb();

const api = `${base}/api/shops/${encodeURIComponent(shop)}`;
const catalog = await getJson(`${api}/catalog`, {}).then((r) => r.body?.products ?? exit(`catalog failed: ${r.status}`));
console.error(`target ${base} · shop ${shop} · ${cases.length} cases × ${runs} runs · db ${db ? db.url : "off"}`);

const results = [...previous.filter((r) => !r.harnessError)];
// Shoppers created in the last hour, also by the run being resumed.
let newShoppers = local ? 0 : results.filter((r) => Date.now() - Date.parse(r.at ?? 0) < 3_600_000).length;
outer: for (const c of cases) {
  for (let run = 1; run <= runs; run++) {
    if (done.has(`${c.id}#${run}`)) continue;
    // Vercel allows 20 new shoppers per IP per hour; local dev trusts x-real-ip.
    if (!local && newShoppers >= 20) {
      console.error(`stopping: 20 new shoppers per hour is the web chat limit. Later: node ${process.argv[1]} --base ${base} --runs ${runs} --label ${label} --resume ${out}`);
      break outer;
    }
    newShoppers++;
    const result = await replayCase(c, run);
    results.push(result);
    save();
    console.error(`${c.id} run ${run}: ${result.harnessError ? "HARNESS ERROR " + result.harnessError : result.pass ? "pass" : "FAIL " + result.turns.flatMap((t) => t.failures).join("; ")}`);
    if (result.harnessError?.startsWith("429")) break outer;
  }
}
save();
console.log(summary());

async function replayCase(c, run) {
  const jar = { cookie: null, ip: local ? `replay-${randomUUID()}` : null };
  const productId = c.viewing ? catalog.find((p) => p.name === c.viewing)?.id ?? null : null;
  if (c.viewing && !productId) return { case: c.id, run, harnessError: `viewing product "${c.viewing}" not in catalog` };
  const at = new Date().toISOString();
  const turns = [];
  for (const [i, t] of c.turns.entries()) {
    const t0 = Date.now();
    const post = await send("POST", { text: t.text, productId, clientMessageId: randomUUID() }, jar);
    const seconds = (Date.now() - t0) / 1000;
    if (post.status !== 200) return { case: c.id, run, at, turns, harnessError: `${post.status} ${post.body?.error ?? ""}`.trim() };
    const history = await send("GET", null, jar);
    const messages = history.body?.messages ?? [];
    const mine = messages.findLastIndex((m) => m.sender === "shopper");
    const answer = messages.slice(mine + 1).find((m) => m.sender === "ai" || m.sender === "system") ?? null;
    const turnLog = db ? await db.turn(jar.cookie, i) : null;
    const reply = answer?.reply ?? (answer ? { text: answer.text, products: [], quickReplies: [] } : null);
    turns.push({ text: t.text, status: post.body?.status, seconds, reply, turnLog, failures: grade(t, reply, turnLog) });
  }
  return { case: c.id, story: c.story, run, at, manual: c.manual ?? null, pass: turns.every((t) => t.failures.length === 0), turns };
}

function grade(t, reply, log) {
  const f = [];
  if (!reply) return ["no reply"];
  const text = fold(reply.text);
  const handoff = log ? log.handoff : undefined;
  if (log === null && db) f.push("ai_turns row not found");
  if (handoff !== undefined && "handoff" in t) {
    const want = t.handoff === null ? [null] : t.handoff;
    if (!want.includes(handoff)) f.push(`handoff ${handoff} (want ${want.join("|")})`);
  }
  for (const tool of t.tools ?? []) if (log && !log.tools.some((x) => x.name === tool)) f.push(`tool ${tool} not called`);
  if (t.replyIncludesAny && !t.replyIncludesAny.some((w) => text.includes(fold(w)))) f.push(`reply lacks ${t.replyIncludesAny.join("|")}`);
  for (const w of t.replyExcludesAny ?? []) if (text.includes(fold(w))) f.push(`reply has "${w}"`);
  if (t.cardsIncludeAny && !reply.products.some((p) => t.cardsIncludeAny.includes(p.name))) f.push("expected card missing");
  if (t.questionMarks !== undefined && (reply.text.match(/\?/g) ?? []).length !== t.questionMarks) f.push(`want ${t.questionMarks} question`);
  // Checks on every reply (spec F2, F6, PB-07).
  const english = /\b(stock|in stock|out of stock|size chart|sold out|available)\b/i.exec(reply.text);
  if (english) f.push(`English word "${english[0]}"`);
  for (const q of reply.quickReplies) if (!quickReplyInCatalog(q)) f.push(`quick reply "${q}" names no product of the shop`);
  if (log) for (const n of unbackedNumbers(reply.text, log.tools, t.text)) f.push(`number ${n} not from a tool`);
  return f;
}

function quickReplyInCatalog(q) {
  const words = fold(q).split(" ");
  if (!GARMENT.some((g) => ` ${fold(q)} `.includes(` ${g} `))) return true;
  const rest = words.filter((w) => !STOP.has(w));
  return catalog.some((p) => {
    const hay = ` ${fold([p.name, p.category ?? "", ...p.colors, ...p.sizesInStock].join(" "))} `;
    return rest.every((w) => hay.includes(` ${w} `) || hay.includes(w));
  });
}

// Prices ("350k", "350.000đ", "350 nghìn") and stock ("còn 7 cái") must come from tool outputs.
function unbackedNumbers(reply, tools, shopperText) {
  const allowed = new Set();
  const walk = (v, key) => {
    if (typeof v === "number" && /^(price|unitPrice|lineTotal|total|stock|subtotal)$/.test(key ?? "")) allowed.add(v);
    else if (typeof v === "string") for (const a of amounts(v)) allowed.add(a);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? key : k);
  };
  for (const t of tools) walk(t.output);
  const shopper = new Set(amounts(shopperText));
  const bad = [];
  for (const a of amounts(reply)) if (!allowed.has(a) && !shopper.has(a)) bad.push(a);
  for (const m of fold(reply).matchAll(/con\s+(\d+)\s*(cai|chiec|sp|san pham)/g)) if (!allowed.has(Number(m[1]))) bad.push(`còn ${m[1]}`);
  return bad;
}
function amounts(s) {
  const out = [];
  for (const m of s.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghìn|ngàn|đ|đồng|vnđ)(?![\p{L}])/giu)) {
    const n = Number(m[1].replace(/[.,]/g, ""));
    out.push(/^(k|nghìn|ngàn)$/i.test(m[2]) ? n * 1000 : n);
  }
  return out;
}

async function openDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("db off: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY of the target's database (or pass --no-db)");
    return null;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    url,
    // The i-th customer ai_turns row of this shopper's conversation.
    async turn(cookie, i) {
      const externalId = createHash("sha256").update(cookie).digest("base64url");
      const shopper = await client.from("shoppers").select("id, conversations(id)").eq("channel", "web").eq("external_id", externalId).maybeSingle();
      const conversationId = shopper.data?.conversations?.[0]?.id ?? shopper.data?.conversations?.id;
      if (!conversationId) return null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const rows = await client.from("ai_turns").select("tool_calls, handoff_reason, latency_ms, prompt_version, postcheck")
          .eq("conversation_id", conversationId).eq("mode", "customer").order("created_at");
        const row = rows.data?.[i];
        if (row) return {
          conversationId, handoff: row.handoff_reason, latencyMs: row.latency_ms, promptVersion: row.prompt_version, postcheck: row.postcheck,
          tools: (row.tool_calls ?? []).map((t) => ({ name: t.name, input: t.input, output: t.output, error: t.error })),
        };
        await new Promise((r) => setTimeout(r, 500)); // the row is written just after the reply
      }
      return null;
    },
  };
}

async function send(method, body, jar) {
  const headers = { "content-type": "application/json" };
  if (jar.cookie) headers.cookie = `shopmate_shopper=${jar.cookie}`;
  if (jar.ip) headers["x-real-ip"] = jar.ip;
  const res = await fetch(`${api}/chat`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = /^shopmate_shopper=([^;]+)/.exec(c);
    if (m) jar.cookie = m[1];
  }
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function summary() {
  const lines = [`# Replay ${label} · ${base} · ${new Date().toISOString()}`, ""];
  const versions = [...new Set(results.flatMap((r) => (r.turns ?? []).map((t) => t.turnLog?.promptVersion).filter(Boolean)))];
  const graded = results.filter((r) => !r.harnessError);
  const secs = graded.flatMap((r) => r.turns.map((t) => t.seconds)).sort((a, b) => a - b);
  const pick = (q) => (secs.length ? secs[Math.min(secs.length - 1, Math.floor(q * secs.length))].toFixed(1) : "-");
  lines.push(`Prompt: ${versions.join(", ") || "unknown (db off)"} · Passed: ${graded.filter((r) => r.pass).length}/${graded.length} · Harness errors: ${results.length - graded.length}`);
  const server = graded.flatMap((r) => r.turns.map((t) => t.turnLog?.latencyMs).filter((v) => v != null)).sort((a, b) => a - b);
  const serverMedian = server.length ? (server[Math.floor(server.length / 2)] / 1000).toFixed(1) + " s" : "-";
  lines.push(`Latency per turn: client median ${pick(0.5)} s, p90 ${pick(0.9)} s, max ${secs.length ? secs.at(-1).toFixed(1) : "-"} s; engine (ai_turns) median ${serverMedian} · Baseline ${spec.baseline?.date}: ${spec.baseline?.passed}, median ${spec.baseline?.latencyMedianS} s, max ${spec.baseline?.latencyMaxS} s`, "");
  lines.push("| Case | Story | Pass | Failures |", "|---|---|---|---|");
  for (const c of cases) {
    const rs = graded.filter((r) => r.case === c.id);
    const fails = [...new Set(rs.flatMap((r) => r.turns.flatMap((t) => t.failures)))];
    lines.push(`| ${c.id} | ${c.story} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${fails.join("; ") || "-"} |`);
  }
  const handoffs = {};
  for (const r of graded) for (const t of r.turns) if (t.turnLog?.handoff) handoffs[t.turnLog.handoff] = (handoffs[t.turnLog.handoff] ?? 0) + 1;
  lines.push("", `Handoff reasons: ${Object.entries(handoffs).map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}`);
  const manual = cases.filter((c) => c.manual).map((c) => `- ${c.id}: ${c.manual}`);
  if (manual.length) lines.push("", "Read by hand:", ...manual);
  lines.push("", `Full results: ${out}`);
  return lines.join("\n");
}
function save() {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ base, shop, label, at: new Date().toISOString(), results }, null, 2));
}
function fold(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^\p{L}\p{N}? ]+/gu, " ").replace(/\s+/g, " ").trim();
}
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, "");
    if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) o[k] = true;
    else o[k] = argv[++i];
  }
  return o;
}
function exit(msg) {
  console.error(msg);
  process.exit(2);
}
