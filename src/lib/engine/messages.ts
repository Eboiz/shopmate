import type Anthropic from "@anthropic-ai/sdk";
import { MAX_PHOTOS_PER_MESSAGE, type HistoryMessage, type PhotoInput } from "@/contract";
import { EngineError } from "./types";

// PB-30: what the model reads in place of a shopper message that was only photos.
export const PHOTO_ONLY_TEXT = "(Khách gửi ảnh, không kèm lời nhắn)";
// PB-30: a photo of an earlier turn is not sent again; the model sees this mark.
export const EARLIER_PHOTO_MARK = "[Khách đã gửi ảnh]";

// PB-30: the paths of the photos in the shopper's latest turn (their messages
// after the last message of anyone else), in order, at most 4.
export function latestShopperPhotoPaths(history: HistoryMessage[]): string[] {
  const paths: string[] = [];
  for (let i = history.length - 1; i >= 0 && history[i].sender === "shopper"; i--) {
    paths.unshift(...(history[i].photoPaths ?? []));
  }
  return paths.slice(0, MAX_PHOTOS_PER_MESSAGE);
}

// Conversation history in the shape the Claude API takes: user/assistant
// alternating, starting with user and ending with the shopper's message.
// Shopper messages that arrive back to back (Messenger sends in bursts) merge
// into one turn; system notices are not part of the dialogue.
// PB-30: latestPhotos (the photos of latestShopperPhotoPaths) go into the last
// user turn as image blocks before its text.
export function toModelMessages(history: HistoryMessage[], latestPhotos: PhotoInput[] = []): Anthropic.MessageParam[] {
  let lastTurnStart = history.length;
  while (lastTurnStart > 0 && history[lastTurnStart - 1].sender === "shopper") lastTurnStart--;

  const out: { role: "user" | "assistant"; content: string }[] = [];
  history.forEach(({ sender, text, photoPaths }, i) => {
    const hasPhotos = sender === "shopper" && (photoPaths?.length ?? 0) > 0;
    const marked = hasPhotos && i < lastTurnStart ? [text.trim(), EARLIER_PHOTO_MARK].filter(Boolean).join(" ") : text;
    if (marked.trim() === "" && !hasPhotos) return;
    const role = sender === "shopper" ? "user" : "assistant";
    if (out.length === 0 && role === "assistant") return;
    const last = out.at(-1);
    if (last?.role === role) last.content = [last.content, marked].filter((t) => t.trim() !== "").join("\n");
    else out.push({ role, content: marked });
  });
  if (out.at(-1)?.role !== "user") throw new EngineError("last_message_not_from_shopper");

  if (latestPhotos.length === 0) {
    // A photo-only turn whose photos could not be loaded still reads as one.
    const last = out.at(-1)!;
    if (last.content.trim() === "") last.content = PHOTO_ONLY_TEXT;
    return out;
  }
  const last = out.at(-1)!;
  const images: Anthropic.ImageBlockParam[] = latestPhotos.map((p) => ({
    type: "image",
    source: { type: "base64", media_type: p.mediaType, data: p.base64 },
  }));
  return [
    ...out.slice(0, -1),
    { role: "user", content: [...images, { type: "text", text: last.content.trim() === "" ? PHOTO_ONLY_TEXT : last.content }] },
  ];
}
