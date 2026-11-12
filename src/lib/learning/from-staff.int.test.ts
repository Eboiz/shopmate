import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnInput, LearnResult } from "@/contract";
import { FX, seedTwoShops } from "@/lib/engine/test/two-shops";
import { createAdminClient } from "@/lib/supabase/admin";
import { learnFromStaffMessage } from "./from-staff";

// PB-35a: a staff message in a conversation with an open question is learned
// (PB-35b's learnFromStaffReply, faked here), and the result is stored by the rules
// of the contract: auto + no review -> active; otherwise pending; skip or error ->
// nothing stored and the question stays open.
const db = createAdminClient();
const A = FX.a.shop;
const email = "pb35a-int-staff@shopmate.local";
let staffId: string;

async function removeStaffUser() {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email);
  if (user) await db.auth.admin.deleteUser(user.id);
}

beforeAll(async () => {
  await removeStaffUser();
  const { data, error } = await db.auth.admin.createUser({ email, password: "pb35a-int-staff-password", email_confirm: true });
  if (error) throw error;
  staffId = data.user.id;
});
afterAll(async () => {
  await db.from("messages").delete().eq("shop_id", A);
  await removeStaffUser();
});

const learnt = (over: Partial<Extract<LearnResult, { status: "learn" }>> = {}): LearnResult => ({
  status: "learn",
  policyKind: "giao_hang",
  rule: "Shop cho kiểm hàng trước khi nhận.",
  evidence: "shop có cho kiểm hàng trước khi nhận",
  needsReview: false,
  reviewReasons: [],
  reason: "",
  ...over,
});

async function staffMessage(text: string) {
  const { data, error } = await db
    .from("messages")
    .insert({ shop_id: A, conversation_id: FX.a.conversation, sender: "staff", staff_id: staffId, text })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { shopId: A, conversationId: FX.a.conversation, messageId: data.id, text };
}

async function openGap(over: { product_id?: string; reason?: "policy_not_covered" | "not_covered_by_data" | "product_not_found" } = {}) {
  const { data, error } = await db
    .from("data_gaps")
    .insert({ shop_id: A, conversation_id: FX.a.conversation, reason: "policy_not_covered", question: "Có cho kiểm hàng không?", ...over })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

const gap = async (id: string) => (await db.from("data_gaps").select("status, learned_fact_id").eq("id", id).single()).data;
const facts = async () => (await db.from("learned_facts").select("id, status, policy_kind, product_id, text, source_message_id").eq("shop_id", A)).data ?? [];

describe("learnFromStaffMessage", () => {
  beforeEach(async () => {
    // Staff messages point at the staff profile, which the reseed deletes (L024).
    await db.from("messages").delete().eq("shop_id", A);
    await seedTwoShops(db);
    const profile = await db.from("profiles").insert({ id: staffId, shop_id: A, role: "staff", full_name: "PB-35a test" });
    if (profile.error) throw profile.error;
    await db.from("shops").update({ learning_mode: "auto" }).eq("id", A);
  });

  it("auto mode: a rule that needs no review is used at once, and the question is closed", async () => {
    const id = await openGap();
    const msg = await staffMessage("Dạ shop có cho kiểm hàng trước khi nhận ạ");
    const learn = vi.fn(async (_: LearnInput) => learnt());
    expect(await learnFromStaffMessage(db, msg, learn)).toBe("active");
    expect(learn.mock.calls[0][0]).toMatchObject({ question: "Có cho kiểm hàng không?", staffReply: msg.text });
    expect(learn.mock.calls[0][0].policies).toContainEqual({ kind: "doi_tra", content: "Đổi trong 7 ngày" });
    const [fact] = await facts();
    expect(fact).toMatchObject({ status: "active", policy_kind: "giao_hang", product_id: null, source_message_id: msg.messageId });
    expect(await gap(id)).toEqual({ status: "learned", learned_fact_id: fact.id });
  });

  it("review mode, or a rule that needs review: stored pending", async () => {
    await openGap();
    expect(await learnFromStaffMessage(db, await staffMessage("Dạ được giảm 10% ạ"), async () => learnt({ needsReview: true, reviewReasons: ["discount"] }))).toBe("pending");
    await db.from("shops").update({ learning_mode: "review" }).eq("id", A);
    await openGap();
    expect(await learnFromStaffMessage(db, await staffMessage("Dạ có ạ"), async () => learnt())).toBe("pending");
    expect((await facts()).map((f) => f.status)).toEqual(["pending", "pending"]);
  });

  it("a question about a product becomes a pending fact of that product, never a policy", async () => {
    const id = await openGap({ reason: "not_covered_by_data", product_id: FX.a.vay01 });
    expect(await learnFromStaffMessage(db, await staffMessage("Dạ váy này vải linen, không co giãn ạ"), async () => learnt({ rule: "Vải linen, không co giãn." }))).toBe("pending");
    const [fact] = await facts();
    expect(fact).toMatchObject({ status: "pending", policy_kind: null, product_id: FX.a.vay01, text: "Vải linen, không co giãn." });
    expect((await gap(id))?.status).toBe("learned");
  });

  it("skip or an error stores nothing and leaves the question open", async () => {
    const id = await openGap();
    expect(await learnFromStaffMessage(db, await staffMessage("Dạ để em hỏi lại"), async () => ({ status: "skip", skipReason: "one_off", reason: "" }))).toBe("skipped");
    await expect(learnFromStaffMessage(db, await staffMessage("Dạ có ạ"), async () => { throw new Error("model down"); })).rejects.toThrow("model down");
    expect(await facts()).toEqual([]);
    expect(await gap(id)).toEqual({ status: "open", learned_fact_id: null });
  });

  it("does nothing without an open question, and never learns product_not_found", async () => {
    const learn = vi.fn(async () => learnt());
    expect(await learnFromStaffMessage(db, await staffMessage("Dạ chào chị"), learn)).toBe("no_gap");
    await openGap({ reason: "product_not_found" });
    expect(await learnFromStaffMessage(db, await staffMessage("Dạ shop chưa có áo da ạ"), learn)).toBe("no_gap");
    expect(learn).not.toHaveBeenCalled();
  });

  it("two staff messages at once learn the question once", async () => {
    await openGap();
    const learn = vi.fn(async () => learnt());
    const results = await Promise.all([
      learnFromStaffMessage(db, await staffMessage("Dạ có ạ"), learn),
      learnFromStaffMessage(db, await staffMessage("Dạ có cho kiểm hàng ạ"), learn),
    ]);
    expect(results.sort()).toEqual(["active", "no_gap"]);
    expect(await facts()).toHaveLength(1);
  });
});
