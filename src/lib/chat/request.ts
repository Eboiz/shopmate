import { z } from "zod";
import { idSchema } from "@/contract";

// Request rules for the web chat routes (PB-04). Error texts are Vietnamese:
// the shop page shows `error` as is.

// Same rule as shops.slug in the schema.
export const shopSlugSchema = z.string().max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

// The shop page caps the input at 1000 characters too.
export const MAX_MESSAGE_LENGTH = 1000;

export const chatPostSchema = z.object({
  text: z
    .string({ error: "Tin nhắn không hợp lệ." })
    .trim()
    // May be empty when a photo is sent (PB-30); the route checks that one of
    // the two is there.
    .max(MAX_MESSAGE_LENGTH, { error: `Tin nhắn tối đa ${MAX_MESSAGE_LENGTH} ký tự.` }),
  productId: idSchema.nullable().optional(),
  // A random id per message from the browser, reused when it retries the send.
  clientMessageId: z.string().trim().min(1).max(100),
});

export type ChatPost = z.infer<typeof chatPostSchema>;

export const chatErrors = {
  shopNotFound: "Không tìm thấy cửa hàng.",
  emptyMessage: "Vui lòng nhập tin nhắn.",
  invalidBody: "Tin nhắn không hợp lệ. Vui lòng thử lại.",
  productNotFound: "Sản phẩm này không còn trong cửa hàng. Vui lòng bỏ chọn và hỏi lại.",
  sendFailed: "Không gửi được tin nhắn. Vui lòng thử lại.",
  historyFailed: "Không tải được cuộc trò chuyện. Vui lòng thử lại.",
  catalogFailed: "Không tải được sản phẩm. Vui lòng thử lại.",
} as const;

// The first validation message to show, or a generic one.
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.path[0] === "text" ? issue.message : chatErrors.invalidBody;
}
