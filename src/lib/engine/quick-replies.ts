// PB-05: a quick reply is a message the shopper can tap, so it must only name
// garments the shop really sells. The model writes them; this check drops the
// ones naming a garment no product of the shop matches.
import type { Reply } from "@/contract";
import type { CatalogItem } from "./jev";
import { fold } from "./text";

export type QuickReply = Reply["quickReplies"][number];

// Folded (see text.ts). A reply without one of these names no garment, so it
// stays; one with a garment word must match a product (see filterQuickReplies).
export const GARMENT_WORDS = [
  "ao",
  "vay",
  "dam",
  "quan",
  "chan vay",
  "khoac",
  "so mi",
  "somi",
  "blazer",
  "bomber",
  "cardigan",
  "gile",
  "jean",
  "jacket",
  "len",
  "hoodie",
  "croptop",
];

// Folded. Words that say nothing about which garment: "Xem bomber" is about the
// bomber, "Đặt size S màu Trắng" about the size and color.
export const QUICK_REPLY_STOP_WORDS = [
  "xem",
  "dat",
  "tim",
  "lai",
  "mua",
  "them",
  "khac",
  "cho",
  "minh",
  "toi",
  "size",
  "mau",
  "nhe",
  "hoi",
  "gi",
  "nao",
  "con",
  "khong",
  "mau khac",
  "loai",
];

// Folded tokens: punctuation separates words, diacritics are gone.
function wordsOf(text: string): string[] {
  return fold(text).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
}

// Whole-word (or whole-phrase) match, so "cao" is not read as "ao".
function hasPhrase(words: string[], phrase: string): boolean {
  const parts = phrase.split(" ");
  for (let i = 0; i + parts.length <= words.length; i++) {
    if (parts.every((part, j) => words[i + j] === part)) return true;
  }
  return false;
}

export function filterQuickReplies(replies: QuickReply[], catalog: CatalogItem[]): QuickReply[] {
  const haystacks = catalog.map((item) =>
    fold([item.name, item.category ?? "", ...item.colors, ...item.sizes].join(" ")),
  );
  return replies.filter((reply) => {
    const words = wordsOf(reply);
    if (!GARMENT_WORDS.some((garment) => hasPhrase(words, garment))) return true;
    const required = words.filter((word) => !QUICK_REPLY_STOP_WORDS.includes(word));
    return haystacks.some((haystack) => required.every((word) => haystack.includes(word)));
  });
}
