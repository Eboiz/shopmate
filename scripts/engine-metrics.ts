// Engine metrics from ai_turns (PB-03): latency and TTFT percentiles, tool call
// success, tokens, model and tool calls per turn, handoffs. Read only.
//
//   pnpm engine:metrics [--shop <uuid>] [--since 24h|7d] [--model <name>] [--prompt <version>]
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the environment
// (or .env.local). Doesn't import src/lib/supabase/admin.ts: it is server-only.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../src/contract/database.types.ts";
import { sampleFromTurnRow, summarize, type GroupSummary } from "../src/lib/engine/metrics.ts";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    shop: { type: "string" },
    since: { type: "string" },
    model: { type: "string" },
    prompt: { type: "string" },
  },
});

const envFile = new URL("../.env.local", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || fail("NEXT_PUBLIC_SUPABASE_URL is not set");
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || fail("SUPABASE_SECRET_KEY is not set");
const db = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

function sinceDate(value: string): string {
  const match = /^(\d+)([hd])$/.exec(value) ?? fail(`--since takes e.g. 24h or 7d, not ${value}`);
  const hours = Number(match[1]) * (match[2] === "d" ? 24 : 1);
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

const PAGE = 1000;
const rows: Tables<"ai_turns">[] = [];
for (let from = 0; ; from += PAGE) {
  let query = db.from("ai_turns").select("*").order("created_at").range(from, from + PAGE - 1);
  if (args.shop) query = query.eq("shop_id", args.shop);
  if (args.since) query = query.gte("created_at", sinceDate(args.since));
  if (args.model) query = query.eq("model", args.model);
  if (args.prompt) query = query.eq("prompt_version", args.prompt);
  const { data, error } = await query;
  if (error) fail(`ai_turns: ${error.message}`);
  rows.push(...data);
  if (data.length < PAGE) break;
}

const summary = summarize(rows.map(sampleFromTurnRow));
const ms = (v: number | null) => (v === null ? "-" : `${Math.round(v)}`);
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null) => (v === null ? "-" : v.toFixed(2));

console.log(`ai_turns: ${rows.length} turns${args.shop ? ` · shop ${args.shop}` : ""}${args.since ? ` · since ${args.since}` : ""}${args.model ? ` · model ${args.model}` : ""}${args.prompt ? ` · prompt ${args.prompt}` : ""}`);
const table: Record<string, Record<string, string | number>> = {};
for (const [mode, groups] of Object.entries(summary.byMode)) {
  for (const [kind, g] of Object.entries(groups) as [string, GroupSummary][]) {
    if (g.turns === 0) continue;
    table[`${mode} ${kind}`] = {
      turns: g.turns,
      "latency p50/p90/p99 ms": `${ms(g.latency.p50)} / ${ms(g.latency.p90)} / ${ms(g.latency.p99)}`,
      "ttft p50/p90/p99 ms (n)": `${ms(g.ttft.p50)} / ${ms(g.ttft.p90)} / ${ms(g.ttft.p99)} (${g.ttft.n})`,
      "tool calls": g.tools.total,
      "tool ok": pct(g.tools.okRate),
      "invalid input": pct(g.tools.invalidInputRate),
      "not found": pct(g.tools.notFoundRate),
      "tokens in/out avg": `${num(g.tokens.inputAvg)} / ${num(g.tokens.outputAvg)}`,
      "model calls avg": num(g.calls.modelAvg),
      "tool calls avg": num(g.calls.toolAvg),
      handoff: pct(g.handoff.rate),
    };
  }
}
console.table(table);
for (const [mode, groups] of Object.entries(summary.byMode)) {
  for (const [kind, g] of Object.entries(groups) as [string, GroupSummary][]) {
    if (g.tools.total > 0) console.log(`${mode} ${kind} by tool:`, JSON.stringify(g.tools.byTool), "outcomes:", JSON.stringify(g.tools.byOutcome));
    if (Object.keys(g.handoff.byReason).length > 0) console.log(`${mode} ${kind} handoffs:`, JSON.stringify(g.handoff.byReason));
  }
}
