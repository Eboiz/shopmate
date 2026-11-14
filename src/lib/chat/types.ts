import { z } from "zod";
import { conversationModeSchema, messageSenderSchema, replySchema } from "@/contract";

export const chatMessageSchema = z.object({
  id: z.uuid(),
  sender: messageSenderSchema,
  text: z.string(),
  reply: replySchema.nullable(),
  // PB-30: the shopper's photos, as signed URLs valid for an hour ("" when one
  // could not be signed). Missing (a response from before PB-30) means none.
  photoUrls: z.array(z.string()).default([]),
  createdAt: z.string(),
});

// mode (PB-42): the conversation mode (PB-00), so the shop page can tell a
// pending AI turn from a wait for staff. Defaults to "ai" for older responses.
export const chatHistorySchema = z.object({
  messages: z.array(chatMessageSchema),
  mode: conversationModeSchema.default("ai"),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatHistory = z.infer<typeof chatHistorySchema>;
