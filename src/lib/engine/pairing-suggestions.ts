import type { HistoryMessage, ProductCard, Reply, ToolOutput } from "@/contract";
import { fold } from "./text";

type Pairing = ToolOutput<"get_pairings">["pairings"][number];

export const MAX_MATCHING_SUGGESTIONS = 2;
// Asked when the shopper wants matches but no product is known. PB-31 AC12: it
// comes with the shop's paired products as buttons (EngineStore.pairedProductNames).
export const ASK_PAIRING_PRODUCT_TEXT = "Bạn muốn phối cùng sản phẩm nào? Hãy chọn món hoặc cho shop biết tên sản phẩm nhé.";
const INTRO = "Shop gợi ý phối cùng:";
const MAX_REPLY_LENGTH = 1000; // PB-00 reply.text limit

// The shopper's message answers "phối cùng sản phẩm nào?" (a tapped button, or a typed name).
export function answersPairingQuestion(history: HistoryMessage[]): boolean {
  const i = history.findLastIndex((m) => m.sender === "shopper");
  const before = history.slice(0, i).findLast((m) => m.sender !== "shopper");
  return i > 0 && before?.sender === "ai" && before.text === ASK_PAIRING_PRODUCT_TEXT;
}

export function isMatchingQuestion(history: HistoryMessage[]): boolean {
  if (answersPairingQuestion(history)) return true;
  const latest = [...history].reverse().find((message) => message.sender === "shopper");
  if (!latest) return false;
  const text = fold(latest.text);
  return /\b(phoi|mix|match|ket hop|di cung|mac cung|hop voi)\b/.test(text)
    || /\b(goi y|tu van)\b.*\b(ao|quan|vay|mon|do|set)\b/.test(text);
}

// An explicit size in the shopper's messages wins over a model-supplied size.
// Read from newest to oldest so a correction ("size L, not M") takes effect.
export function knownShopperSize(history: HistoryMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].sender !== "shopper") continue;
    const text = fold(history[i].text);
    const mentions = [...text.matchAll(/\b(?:size|co|mac)\s*(?:ao|quan|vay)?\s*(?:la|:)?\s*(3xl|xxl|xl|xs|s|m|l|\d{2})\b/gi)];
    if (mentions.length > 0) return mentions.at(-1)![1].toUpperCase();
  }
  return null;
}

// The model cannot write or select matching-item cards. They come only from
// get_pairings, and are rechecked against fresh stock immediately before reply.
export function matchingReply(pairings: Pairing[], freshCards: ProductCard[]): Reply {
  const cards = new Map(freshCards.map((card) => [card.productId, card]));
  const seen = new Set<string>();
  const selected: ProductCard[] = [];
  let text = INTRO;

  for (const pairing of pairings) {
    if (seen.has(pairing.productId)) continue;
    seen.add(pairing.productId);
    const card = cards.get(pairing.productId);
    if (!card) continue;
    const allowedSizes = new Set(pairing.sizesInStock.map(fold));
    const sizesInStock = card.sizesInStock.filter((size) => allowedSizes.has(fold(size)));
    if (sizesInStock.length === 0) continue;
    const line = `\n• ${card.name}: ${pairing.reason}`;
    // A full owner-written reason must fit the shared reply contract. Skip an
    // overlong one rather than silently cutting or inventing its meaning.
    if (text.length + line.length > MAX_REPLY_LENGTH) continue;
    text += line;
    selected.push({ ...card, sizesInStock });
    if (selected.length === MAX_MATCHING_SUGGESTIONS) break;
  }

  if (selected.length === 0) {
    return { text: "Hiện shop chưa có món phối phù hợp còn hàng ở size bạn cần.", products: [], quickReplies: [] };
  }

  // The reason is the owner's text, not a model paraphrase. No other product
  // names can enter this reply, including when the model invents productIds.
  return {
    text,
    products: selected,
    quickReplies: [],
  };
}
