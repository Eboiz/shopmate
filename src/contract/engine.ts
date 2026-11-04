import { z } from "zod";
import { idSchema, messageSenderSchema } from "./enums";
import { quickReplySchema, replySchema } from "./reply";

export const historyMessageSchema = z.object({
  sender: messageSenderSchema,
  text: z.string(),
});

const shared = {
  history: z.array(historyMessageSchema).min(1),
  // The product the shopper tapped "Hỏi về món này" on (PB-04), if any.
  productId: idSchema.nullable().optional(),
};

// customer: a shopper's conversation; the server reads shop_id from it.
// staff_draft: the reply assistant (PB-20); no conversation, shop_id comes from
// the signed-in staff member's profile. create_draft_order and handoff_to_staff
// are not available in this mode (see toolsForMode).
export const engineInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("customer"), conversationId: idSchema, ...shared }),
  // shopId comes from the signed-in staff member's profile on the server, never
  // from the request body.
  z.object({ mode: z.literal("staff_draft"), shopId: idSchema, ...shared }),
]);

// What the model itself returns: product IDs only. The engine turns them into
// product cards from data, so the model never writes a price into a card.
export const modelReplySchema = z.object({
  text: z.string().max(1000),
  productIds: z.array(idSchema).max(10),
  quickReplies: z.array(quickReplySchema).max(10),
});

export const engineOutputSchema = z.object({
  reply: replySchema,
  // staff_draft only: the question is a complaint, so the assistant shows a note
  // to reply personally instead of a draft (PB-20).
  personalReplyNeeded: z.boolean(),
});

export type HistoryMessage = z.infer<typeof historyMessageSchema>;
export type EngineInput = z.infer<typeof engineInputSchema>;
export type ModelReply = z.infer<typeof modelReplySchema>;
export type EngineOutput = z.infer<typeof engineOutputSchema>;
