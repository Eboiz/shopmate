// PB-35b before/after eval on real Claude and local Supabase (Eboiz/Documents#39).
// Costs real money; CI never runs it.
//
//   pnpm db:start
//   ANTHROPIC_API_URL= pnpm engine:eval src/lib/learning/eval/before-after.eval.ts
//
// 1. before: the 8 questions on shop A as seeded (no informational threshold).
// 2. learn: each topic's staff reply through learnFromStaffReply; an active rule
//    is appended to shop A's policy of its kind, simulating PB-35a's get_policy.
// 3. after: the 8 questions again. AC: >= 7/8 pass (judgeAfter), 0 with an
//    amount the policies don't hold. Saves eval-runs/<date>-learning-before-after.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { policyKindSchema, type LearnResult, type PolicySnapshot, type TablesInsert } from "@/contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDefaultModel } from "@/lib/engine/anthropic-model";
import { runEngine } from "@/lib/engine/engine";
import { PROMPT_VERSION } from "@/lib/engine/prompt";
import { createSupabaseStore, type EngineStore } from "@/lib/engine/store";
import { assertLocalDb, FX, seedTwoShops } from "@/lib/engine/test/two-shops";
import type { Db } from "@/lib/engine/types";
import { learnFromStaffReply, modelNameFrom } from "../learn";
import { LEARNING_PROMPT_VERSION } from "../prompt";
import { appendRule, beforeAfterTopics, judgeAfter, type EngineRun } from "./before-after-cases";

const questions = beforeAfterTopics.flatMap((t) => t.questions.map((q) => ({ ...q, topic: t.id })));

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("learning before/after eval (real Claude)", () => {
  let db: Db;
  let store: EngineStore;
  const model = createDefaultModel();
  const before = new Map<string, EngineRun>();
  const after = new Map<string, EngineRun & ReturnType<typeof judgeAfter>>();
  const learned = new Map<string, LearnResult | { error: string }>();
  let policyTexts: string[] = [];

  async function ask(text: string): Promise<EngineRun> {
    await db.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation);
    await db.from("ai_turns").delete().eq("conversation_id", FX.a.conversation);
    let row: TablesInsert<"ai_turns"> | null = null;
    const capturing: EngineStore = { ...store, insertTurn: (r) => ((row = r), store.insertTurn(r)) };
    const result = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text }], productId: null },
      { model, db, store: capturing },
    );
    await result.turnLogged;
    const calls = (((row as TablesInsert<"ai_turns"> | null)?.tool_calls ?? []) as { name: string }[]).map((c) => c.name);
    return { calledGetPolicy: calls.includes("get_policy"), handoffReason: result.handoffReason, reply: result.output.reply.text };
  }

  async function snapshot(): Promise<PolicySnapshot[]> {
    const { data, error } = await db.from("policies").select("kind, content").eq("shop_id", FX.a.shop);
    if (error) throw new Error(error.message);
    return policyKindSchema.options.map((kind) => ({ kind, content: data.find((p) => p.kind === kind)?.content ?? null }));
  }

  beforeAll(async () => {
    assertLocalDb();
    db = createAdminClient();
    store = createSupabaseStore(db);
    await seedTwoShops(db);
  });

  it("before learning", { timeout: 600_000 }, async () => {
    for (const q of questions) before.set(q.id, await ask(q.text));
  });

  it("learns from the staff replies", { timeout: 300_000 }, async () => {
    for (const t of beforeAfterTopics) {
      try {
        const result = await learnFromStaffReply({ ...t.staff, policies: await snapshot() }, { model });
        learned.set(t.id, result);
        if (result.status !== "learn" || result.needsReview) continue;
        const current = (await snapshot()).find((p) => p.kind === result.policyKind)?.content ?? null;
        const { error } = await db
          .from("policies")
          .upsert({ shop_id: FX.a.shop, kind: result.policyKind, content: appendRule(current, result.rule) });
        if (error) throw new Error(error.message);
      } catch (e) {
        learned.set(t.id, { error: String(e) });
      }
    }
    policyTexts = (await snapshot()).flatMap((p) => (p.content?.trim() ? [p.content] : []));
  });

  it("after learning", { timeout: 600_000 }, async () => {
    for (const q of questions) {
      const run = await ask(q.text);
      after.set(q.id, { ...run, ...judgeAfter(q, run, policyTexts) });
    }
    expect(after.size).toBe(questions.length);
  });

  afterAll(async () => {
    if (db) await seedTwoShops(db);
    if (after.size === 0) return;
    const passed = [...after.values()].filter((r) => r.passed).length;
    const unsupported = [...after.values()].filter((r) => r.unsupportedAmounts.length > 0).length;
    console.table(
      Object.fromEntries(
        questions.map((q) => {
          const b = before.get(q.id);
          const a = after.get(q.id);
          return [
            q.id,
            {
              before: b ? `${b.calledGetPolicy ? "policy" : "-"}/${b.handoffReason ?? "answered"}` : "-",
              after: a ? `${a.calledGetPolicy ? "policy" : "-"}/${a.handoffReason ?? "answered"}` : "-",
              passed: a?.passed ?? false,
              reply: a?.reply.slice(0, 100) ?? "",
            },
          ];
        }),
      ),
    );
    console.info(`after: ${passed}/${questions.length} ${passed >= 7 ? "PASS" : "FAIL"}; unsupported amounts: ${unsupported} ${unsupported === 0 ? "PASS" : "FAIL"}`);
    mkdirSync("eval-runs", { recursive: true });
    const file = `eval-runs/${new Date().toISOString().slice(0, 10)}-learning-before-after.json`;
    writeFileSync(
      file,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          learningPromptVersion: LEARNING_PROMPT_VERSION,
          enginePromptVersion: PROMPT_VERSION,
          model: modelNameFrom({ model }),
          learned: Object.fromEntries(learned),
          policiesAfterLearning: policyTexts,
          before: Object.fromEntries(before),
          after: Object.fromEntries(after),
          summary: { passed, of: questions.length, unsupported },
        },
        null,
        1,
      ),
    );
    console.info(`eval: saved ${file}`);
  });
});
