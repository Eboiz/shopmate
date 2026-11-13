// PB-45: sizes and colors as the shopper asks for them, read from their own
// words. Pure: no IO.
//  - A size the shop doesn't sell ("muốn mặc size XXL", max is XL) is answered by
//    the server (route.ts unsoldSizeTurn), never left to the model, which once
//    agreed and promised to check XXL stock.
//  - "Còn màu nào khác?" asks for every color: the stock lookup drops the color
//    the shopper named earlier.
import { fold, sortSizes } from "./text";

const plain = (text: string) => fold(text).replace(/[^a-z0-9]+/g, " ");

// "2XL" and "XXL" are the same size, so are "XXXL" and "3XL".
function canonical(size: string): string {
  const s = fold(size).replace(/\s+/g, "");
  if (s === "2xl") return "XXL";
  if (s === "xxxl") return "3XL";
  return s.toUpperCase();
}

// A letter size after a size word ("size XXL", "cỡ L", "mặc M"); a two-digit
// size only after "size" ("size 28": "có 10 cái" is a count); XXL and bigger on
// their own ("có 2XL không"). Folded "co" is both "cỡ" and "có"; "có S không"
// asks for a size as well.
const LETTER_AFTER_WORD = /\b(?:size|sz|mac|co)\s+(?:(?:ao|quan|vay)\s+)?(?:la\s+)?(xxxl|xxl|[2-5]xl|xl|xs|s|m|l)\b/g;
const NUMBER_AFTER_SIZE = /\b(?:size|sz)\s+(?:la\s+)?(\d{2})\b/g;
const BIG_LETTER = /\b(xxxl|xxl|[2-5]xl)\b/g;

// The sizes named in one message, in canonical form, repeats removed.
export function sizesNamedIn(text: string): string[] {
  const t = plain(text);
  const found = [LETTER_AFTER_WORD, NUMBER_AFTER_SIZE, BIG_LETTER].flatMap((re) => [...t.matchAll(re)].map((m) => ({ index: m.index, size: canonical(m[1]) })));
  return [...new Set(found.sort((a, b) => a.index - b.index).map((f) => f.size))];
}

// The first size the message names that is not among `sizes` (what the product,
// or the whole shop, sells). null when it names none, or `sizes` is unknown.
export function sizeNotSold(text: string, sizes: string[]): string | null {
  if (sizes.length === 0) return null;
  const sold = new Set(sizes.map(canonical));
  return sizesNamedIn(text).find((s) => !sold.has(s)) ?? null;
}

// The next larger size the product sells, for a looser fit; null at the top.
export function oneSizeUp(size: string, sizes: string[]): string | null {
  const sorted = sortSizes(sizes);
  const i = sorted.findIndex((s) => canonical(s) === canonical(size));
  return i >= 0 && i + 1 < sorted.length ? sorted[i + 1] : null;
}

// "Còn màu nào khác?", "có màu khác không", "còn những màu gì", "có mấy màu":
// every color in stock, not only the one asked for before.
const OTHER_COLORS = /\bmau (nao|gi) (khac|nua)\b|\bmau khac\b|\b(con|co) (nhung |cac )?mau (nao|gi)\b|\bmau gi nua\b|\bmay mau\b|\bnhung mau nao\b/;
export const asksOtherColors = (text: string) => OTHER_COLORS.test(plain(text));

// The names (colors) the reply leaves out, matched as whole words on folded text.
export function missedMentions(text: string, names: readonly string[]): string[] {
  const t = ` ${plain(text)} `;
  return names.filter((n) => !t.includes(` ${plain(n).trim()} `));
}

// Sent to the model once when its reply left some out.
export const mustMentionNote = (missed: readonly string[]) =>
  `Kiểm tra tự động: câu trả lời bỏ sót ${missed.join(", ")}. Viết lại và nêu đủ mọi màu còn hàng trong dữ liệu, mỗi màu kèm size và số lượng.`;
