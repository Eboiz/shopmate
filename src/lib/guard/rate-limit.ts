import "server-only";
import { sendToConversation } from "@/lib/channels/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMIT_REPLY, isOverLimit, windowStart } from "./rate-limit-rule";

// PB-17: limit how fast one shopper can make the AI answer.
//
// Every channel (web chat PB-04, Messenger PB-15, Instagram, Telegram, WhatsApp)
// calls this after storing the shopper's message and before calling the engine:
//
//   if (await replyIfRateLimited({ shopId, conversationId })) return;
//
// One conversation per shopper (PB-00), and a shopper belongs to one shop and
// one channel identity, so counting the conversation's shopper messages counts
// per shopper. The eval (PB-10) gives each question its own shopper, so it is
// never limited.

type Target = { shopId: string; conversationId: string };

export async function countRecentShopperMessages(
  { shopId, conversationId }: Target,
  now = new Date(),
): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("conversation_id", conversationId)
    .eq("sender", "shopper")
    .gte("created_at", windowStart(now));
  // Fail open: a read error must not silence every shopper. The engine's own
  // limits (PB-03 tool call cap) still apply.
  if (error) {
    console.error("PB-17 rate limit count failed", error.message);
    return 0;
  }
  return count ?? 0;
}

// Returns true when the shopper is over the limit; the polite "wait a moment"
// reply has then been sent and the caller must not call the AI.
export async function replyIfRateLimited(target: Target): Promise<boolean> {
  const count = await countRecentShopperMessages(target);
  if (!isOverLimit(count)) return false;

  // Sent as an AI reply so it goes out only in `ai` mode: once staff took over,
  // the shopper is talking to a person and gets no automatic text.
  const result = await sendToConversation(target.conversationId, RATE_LIMIT_REPLY, { from: "ai" });
  if (!result.ok && result.error !== "not_in_ai_mode") {
    console.error("PB-17 rate limit reply failed", result.error);
  }
  return true;
}
