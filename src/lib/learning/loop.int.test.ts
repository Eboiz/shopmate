import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runEngine } from "@/lib/engine/engine";
import { OFFER_QUESTION } from "@/lib/engine/handoff-offer";
import { createSupabaseStore } from "@/lib/engine/store";
import { finalJson, scriptedModel, toolCalls, toolUse } from "@/lib/engine/test/fake-model";
import { FX, seedTwoShops } from "@/lib/engine/test/two-shops";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeFact } from "./decide";
import { learnFromStaffMessage } from "./from-staff";

// PB-35a AC5, on local Supabase with the model faked: a shopper asks something the
// shop never wrote down -> the AI offers staff and the question is recorded ->
// staff answer -> the next shopper gets the answer from get_policy, no offer ->
// the owner removes it -> the AI can't answer again and the question is reopened.
const db = createAdminClient();
const store = createSupabaseStore(db);
const A = FX.a.shop;
const QUESTION = "Shop có cho kiểm hàng trước khi nhận không?";
const RULE = "Shop cho kiểm hàng trước khi nhận.";
const email = "pb35a-loop-owner@shopmate.local";
let ownerId: string;

async function removeUser() {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email);
  if (user) await db.auth.admin.deleteUser(user.id);
}

async function ask(conversationId: string) {
  const model = scriptedModel([
    toolCalls(toolUse("get_policy", { kind: "giao_hang" })),
    finalJson({ text: `Dạ shop chưa có thông tin này ạ. ${OFFER_QUESTION}`, productIds: [], quickReplies: [] }),
  ]);
  const result = await runEngine({ mode: "customer", conversationId, history: [{ sender: "shopper", text: QUESTION }] }, { model, db, store, onMetrics: () => {} });
  await result.turnLogged;
  const policyResult = JSON.parse(String((model.calls[1].messages.at(-1)!.content as { content: string }[])[0].content));
  return { result, policy: policyResult.content as string | null };
}

beforeAll(async () => {
  await removeUser();
  const { data, error } = await db.auth.admin.createUser({ email, password: "pb35a-loop-owner-password", email_confirm: true });
  if (error) throw error;
  ownerId = data.user.id;
});
afterAll(async () => {
  await db.from("messages").delete().eq("shop_id", A);
  await removeUser();
});

describe("PB-35a closed loop", () => {
  beforeEach(async () => {
    await db.from("messages").delete().eq("shop_id", A);
    await seedTwoShops(db);
    const profile = await db.from("profiles").insert({ id: ownerId, shop_id: A, role: "owner", full_name: "PB-35a owner" });
    if (profile.error) throw profile.error;
  });

  it("asks -> offer + recorded -> staff answer -> next shopper answered -> removed -> offer again", async () => {
    const first = await ask(FX.a.conversation);
    expect(first.policy).toBeNull();
    expect(first.result.output.reply.text).toContain(OFFER_QUESTION);
    const { data: gaps } = await db.from("data_gaps").select("id, reason, question, status").eq("shop_id", A);
    expect(gaps).toEqual([expect.objectContaining({ reason: "policy_not_covered", question: QUESTION, status: "open" })]);

    const { data: msg } = await db
      .from("messages")
      .insert({ shop_id: A, conversation_id: FX.a.conversation, sender: "staff", staff_id: ownerId, text: "Dạ shop có cho kiểm hàng trước khi nhận ạ" })
      .select("id")
      .single();
    const outcome = await learnFromStaffMessage(db, { shopId: A, conversationId: FX.a.conversation, messageId: msg!.id, text: "Dạ shop có cho kiểm hàng trước khi nhận ạ" }, async () => ({
      status: "learn",
      policyKind: "giao_hang",
      rule: RULE,
      evidence: "shop có cho kiểm hàng trước khi nhận",
      needsReview: false,
      reviewReasons: [],
      reason: "",
    }));
    expect(outcome).toBe("active");

    // Another shopper (shop A's other conversation would do; the fixture has one, so
    // the same conversation stands in for "next turn").
    const second = await ask(FX.a.conversation);
    expect(second.policy).toContain(RULE);
    expect(second.result.handoffReason).toBeNull();

    const { data: fact } = await db.from("learned_facts").select("id").eq("shop_id", A).single();
    await removeFact(db, { shopId: A, factId: fact!.id, userId: ownerId });
    const third = await ask(FX.a.conversation);
    expect(third.policy).toBeNull();
    const { data: reopened } = await db.from("data_gaps").select("status, learned_fact_id").eq("id", gaps![0].id).single();
    expect(reopened).toEqual({ status: "open", learned_fact_id: null });
  });

  it("'Không cần' marks the question of the offer turn, never an older open one", async () => {
    const { data: older } = await db
      .from("data_gaps")
      .insert({ shop_id: A, conversation_id: FX.a.conversation, reason: "policy_not_covered", question: "Câu cũ chưa ai trả lời" })
      .select("id")
      .single();
    // An off-topic offer reads no data, so it records no question.
    const offTopic = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text: "Bạn tên gì?" }] },
      { model: scriptedModel([finalJson({ text: `Dạ mình chỉ hỗ trợ về sản phẩm của shop. ${OFFER_QUESTION}`, productIds: [], quickReplies: [] })]), db, store, onMetrics: () => {} },
    );
    await offTopic.turnLogged;
    const { data: offerTurn } = await db.from("ai_turns").select("handoff_offer").eq("conversation_id", FX.a.conversation).order("created_at", { ascending: false }).limit(1).single();
    expect(offerTurn?.handoff_offer).not.toBeNull();
    const decline = await runEngine(
      { mode: "customer", conversationId: FX.a.conversation, history: [{ sender: "shopper", text: "Bạn tên gì?" }, { sender: "ai", text: OFFER_QUESTION }, { sender: "shopper", text: "Không cần" }] },
      { model: scriptedModel([]), db, store, onMetrics: () => {} },
    );
    await decline.turnLogged;
    const { data: gaps } = await db.from("data_gaps").select("id, question, soft_declined").eq("shop_id", A).order("created_at");
    expect(gaps).toEqual([{ id: older!.id, question: "Câu cũ chưa ai trả lời", soft_declined: false }]);
  });
});
