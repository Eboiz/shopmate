"use server";

import { after } from "next/server";
import { z } from "zod";
import { idSchema } from "@/contract";
import { requireStaff } from "@/lib/auth";
import { sendToConversation } from "@/lib/channels/send";
import { learnFromStaffMessage } from "@/lib/learning/from-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// PB-13: a staff reply from the inbox. A server action is reachable with a
// direct POST, so it checks the session itself and takes only ids and text from
// the client; the shop comes from the staff member's profile.

const sendStaffMessageSchema = z.object({
  conversationId: idSchema,
  // Same cap as the inbox text box and the reply shape (PB-00).
  text: z.string().trim().min(1).max(1000),
  // One id per send attempt; a retry reuses it (see sendToConversation).
  requestId: z.uuid(),
});

export type SendStaffMessageResult = { ok: true } | { ok: false; messageId: string | null };

export async function sendStaffMessage(
  conversationId: string,
  text: string,
  requestId: string,
): Promise<SendStaffMessageResult> {
  const staff = await requireStaff();

  const parsed = sendStaffMessageSchema.safeParse({ conversationId, text, requestId });
  if (!parsed.success) return { ok: false, messageId: null };

  // Read through RLS and filtered by the staff member's shop: a conversation of
  // another shop looks the same as a missing one. Staff reply only after taking
  // over, so the AI and a person never answer the same conversation at once.
  const db = await createClient();
  const { data: conversation, error } = await db
    .from("conversations")
    .select("id, mode")
    .eq("id", parsed.data.conversationId)
    .eq("shop_id", staff.shopId)
    .maybeSingle();
  if (error) console.error("PB-13 conversation read failed", error.message);
  if (!conversation || conversation.mode !== "staff") return { ok: false, messageId: null };

  const result = await sendToConversation(
    conversation.id,
    { text: parsed.data.text, products: [], quickReplies: [] },
    { from: "staff", staffId: staff.userId, clientMessageId: parsed.data.requestId },
  );
  if (result.ok) {
    // PB-35a: learn from the reply once it was sent (never from a failed one), after
    // the response; a failure only leaves the question open.
    const sent = { shopId: staff.shopId, conversationId: conversation.id, messageId: result.messageId, text: parsed.data.text };
    after(async () => {
      try {
        await learnFromStaffMessage(createAdminClient(), sent);
      } catch (e) {
        console.error("PB-35a learning failed", e);
      }
    });
    return { ok: true };
  }
  console.error("PB-13 staff reply not confirmed", result.error);
  return { ok: false, messageId: result.messageId };
}
