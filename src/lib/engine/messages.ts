import type Anthropic from "@anthropic-ai/sdk";
import type { HistoryMessage } from "@/contract";
import { EngineError } from "./types";

// Conversation history in the shape the Claude API takes: user/assistant
// alternating, starting with user and ending with the shopper's message.
// Shopper messages that arrive back to back (Messenger sends in bursts) merge
// into one turn; system notices are not part of the dialogue.
export function toModelMessages(history: HistoryMessage[]): Anthropic.MessageParam[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const { sender, text } of history) {
    if (sender === "system" || text.trim() === "") continue;
    const role = sender === "shopper" ? "user" : "assistant";
    if (out.length === 0 && role === "assistant") continue;
    const last = out.at(-1);
    if (last?.role === role) last.content += `\n${text}`;
    else out.push({ role, content: text });
  }
  if (out.at(-1)?.role !== "user") throw new EngineError("last_message_not_from_shopper");
  return out;
}
