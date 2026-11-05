import { z } from "zod";
import { messageSenderSchema, replySchema } from "@/contract";

export const chatMessageSchema = z.object({
  id: z.uuid(),
  sender: messageSenderSchema,
  text: z.string(),
  reply: replySchema.nullable(),
  createdAt: z.string(),
});

export const chatHistorySchema = z.object({ messages: z.array(chatMessageSchema) });

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatHistory = z.infer<typeof chatHistorySchema>;
