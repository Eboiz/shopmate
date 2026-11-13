import type { ConversationMode } from "@/contract";
import type { ChatMessage } from "./types";

// What the web chat shows under the messages (PB-42).
// - typing: an AI turn is running (the conversation is in `ai` mode and the
//   shopper's message is being sent or its reply hasn't shown yet).
// - waiting_staff: the conversation is with staff (needs_human or staff) and
//   the shopper's message is the last one, so no AI will answer it.
// - idle: nothing pending.
export type ChatStatus = "typing" | "waiting_staff" | "idle";

export function chatStatus(
  messages: readonly Pick<ChatMessage, "sender">[],
  mode: ConversationMode,
  sending: boolean,
  awaitingReply = false,
): ChatStatus {
  if (mode === "ai") return sending || awaitingReply ? "typing" : "idle";
  // While sending, the outgoing bubble already says "Đang gửi…".
  if (sending) return "idle";
  return messages.at(-1)?.sender === "shopper" ? "waiting_staff" : "idle";
}
