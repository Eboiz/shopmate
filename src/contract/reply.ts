import { z } from "zod";
import { idSchema, vndSchema } from "./enums";

// A product card. The engine builds it from tool results / the database, never
// from model text, so every price shown comes from data.
export const productCardSchema = z.object({
  productId: idSchema,
  name: z.string().min(1),
  price: vndSchema,
  imageUrl: z.string().nullable(),
  sizesInStock: z.array(z.string()),
});

// Tapping a quick reply sends its text as the shopper's message. 20 characters is
// the Messenger quick reply title limit.
export const quickReplySchema = z.string().trim().min(1).max(20);

// One reply shape for every channel (web chat, Messenger, Instagram, Telegram,
// WhatsApp) and for the PB-07 fallback card. Messenger shows at most 10 cards.
// Text stays within Instagram's 1000-character limit, the smallest of the channels.
export const replySchema = z.object({
  text: z.string().max(1000),
  products: z.array(productCardSchema).max(10),
  quickReplies: z.array(quickReplySchema).max(10),
});

export type ProductCard = z.infer<typeof productCardSchema>;
export type Reply = z.infer<typeof replySchema>;
