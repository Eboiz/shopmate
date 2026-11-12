import type { LearnInput, LearnResult } from "@/contract";
import { createDefaultModel } from "@/lib/engine/anthropic-model";
import type { Db } from "@/lib/engine/types";
import { learnFromStaffReply } from "./learn";

// PB-35a: learn from a staff message sent in a conversation with an open question
// (data_gaps). Runs after the message was sent (after()), with the secret-key client.
//
// The question it answers is the conversation's newest open one of the last 7
// days. It is claimed first (open -> learned, one SQL update), so two staff
// messages at once learn it once. Where the fact goes comes from the question, not
// the model: a question about a product becomes a fact of that product (always
// reviewed, it changes what the AI says about the product); any other one a
// policy fact. Stored as the contract says: learn + no review + shop in auto
// mode -> active, other learn -> pending, skip or error -> nothing, question reopened.

export type LearnOutcome = "active" | "pending" | "skipped" | "no_gap";
export type StaffMessage = { shopId: string; conversationId: string; messageId: string; text: string };
type Learn = (input: LearnInput) => Promise<LearnResult>;

const GAP_DAYS = 7;
const defaultLearn: Learn = (input) => learnFromStaffReply(input, { model: createDefaultModel() });

export async function learnFromStaffMessage(db: Db, msg: StaffMessage, learn: Learn = defaultLearn): Promise<LearnOutcome> {
  const since = new Date(Date.now() - GAP_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: open, error } = await db
    .from("data_gaps")
    .select("id")
    .eq("shop_id", msg.shopId)
    .eq("conversation_id", msg.conversationId)
    .eq("status", "open")
    .in("reason", ["policy_not_covered", "not_covered_by_data"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`data_gaps: ${error.message}`);
  if (!open) return "no_gap";

  const { data: gap, error: claimError } = await db
    .from("data_gaps")
    .update({ status: "learned" })
    .eq("id", open.id)
    .eq("status", "open")
    .select("id, question, product_id")
    .maybeSingle();
  if (claimError) throw new Error(`data_gaps: ${claimError.message}`);
  if (!gap) return "no_gap";

  const reopen = () => db.from("data_gaps").update({ status: "open" }).eq("id", gap.id);
  try {
    const [policies, shop] = await Promise.all([
      db.from("policies").select("kind, content").eq("shop_id", msg.shopId),
      db.from("shops").select("learning_mode").eq("id", msg.shopId).single(),
    ]);
    if (policies.error) throw new Error(`policies: ${policies.error.message}`);
    if (shop.error) throw new Error(`shops: ${shop.error.message}`);

    const result = await learn({
      question: gap.question,
      staffReply: msg.text,
      policies: policies.data.map((p) => ({ kind: p.kind, content: p.content.trim() ? p.content : null })),
    });
    if (result.status === "skip") {
      await reopen();
      return "skipped";
    }

    const active = gap.product_id === null && shop.data.learning_mode === "auto" && !result.needsReview;
    const { data: fact, error: factError } = await db
      .from("learned_facts")
      .insert({
        shop_id: msg.shopId,
        ...(gap.product_id ? { product_id: gap.product_id } : { policy_kind: result.policyKind }),
        text: result.rule,
        source_message_id: msg.messageId,
        status: active ? "active" : "pending",
        review_reasons: result.reviewReasons,
      })
      .select("id")
      .single();
    if (factError) throw new Error(`learned_facts: ${factError.message}`);
    const { error: linkError } = await db.from("data_gaps").update({ learned_fact_id: fact.id }).eq("id", gap.id);
    if (linkError) throw new Error(`data_gaps: ${linkError.message}`);
    return active ? "active" : "pending";
  } catch (e) {
    await reopen();
    throw e;
  }
}
