import type { LearnInput, LearnResult } from "@/contract";
import { createDefaultModel } from "@/lib/engine/anthropic-model";
import { gapWindowStart, LEARNABLE_GAP_REASONS } from "@/lib/engine/data-gap";
import { withFacts } from "@/lib/engine/learned-facts";
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

type StaffLearnOutcome = "active" | "pending" | "skipped" | "no_gap";
type StaffMessage = { shopId: string; conversationId: string; messageId: string; text: string };
type Learn = (input: LearnInput) => Promise<LearnResult>;

const defaultLearn: Learn = (input) => learnFromStaffReply(input, { model: createDefaultModel() });

export async function learnFromStaffMessage(db: Db, msg: StaffMessage, learn: Learn = defaultLearn): Promise<StaffLearnOutcome> {
  const { data: open, error } = await db
    .from("data_gaps")
    .select("id")
    .eq("shop_id", msg.shopId)
    .eq("conversation_id", msg.conversationId)
    .eq("status", "open")
    .in("reason", LEARNABLE_GAP_REASONS)
    .gte("created_at", gapWindowStart())
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
    // The policies as get_policy returns them (learned facts included), so the
    // learner sees a conflict with something it learned before.
    // The shopper's channel name (Messenger, Telegram…) so the learner can redact
    // it from the rule even without "anh"/"chị" in front of it.
    const [policies, facts, shop, conversation] = await Promise.all([
      db.from("policies").select("kind, content").eq("shop_id", msg.shopId),
      db.from("learned_facts").select("policy_kind, text").eq("shop_id", msg.shopId).eq("status", "active").not("policy_kind", "is", null).order("created_at"),
      db.from("shops").select("learning_mode").eq("id", msg.shopId).single(),
      db.from("conversations").select("shoppers(display_name)").eq("id", msg.conversationId).eq("shop_id", msg.shopId).maybeSingle(),
    ]);
    if (policies.error) throw new Error(`policies: ${policies.error.message}`);
    if (facts.error) throw new Error(`learned_facts: ${facts.error.message}`);
    if (shop.error) throw new Error(`shops: ${shop.error.message}`);
    if (conversation.error) throw new Error(`conversations: ${conversation.error.message}`);
    const shopperName = conversation.data?.shoppers?.display_name ?? null;
    const kinds = [...new Set([...policies.data.map((p) => p.kind), ...facts.data.flatMap((f) => (f.policy_kind ? [f.policy_kind] : []))])];

    const result = await learn({
      question: gap.question,
      staffReply: msg.text,
      shopperName,
      policies: kinds.map((kind) => ({
        kind,
        content: withFacts(policies.data.find((p) => p.kind === kind)?.content, facts.data.filter((f) => f.policy_kind === kind).map((f) => f.text)),
      })),
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
