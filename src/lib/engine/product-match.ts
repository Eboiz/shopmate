// PB-31: near-match product search. Used by search_products (LLM tool loop) and
// by the Jev router when the shopper names a product the shop doesn't have.
// Pure: no IO.
import { fold } from "./text";

// Shoppers' other words for what the shop calls something. Each key is folded;
// the value is the word the catalog uses. Multi-word keys are matched first.
const SYNONYMS: Array<[string, string]> = [
  // "xanh đậm" is a color, not a dress: protected before "dam" -> "vay".
  ["xanh dam", "xanhdam"],
  ["quan bo", "quan jean"],
  ["so mi", "somi"],
  ["dam", "vay"],
  ["denim", "jean"],
  ["jacket", "khoac"],
];

// Words that say nothing about which product: questions, fillers, colors are
// handled elsewhere (get_stock), so they don't count toward a match.
const NOISE = new Set([
  "shop", "co", "khong", "ko", "k", "con", "hang", "cai", "chiec", "mau", "size", "loai", "nao", "gi", "the",
  "a", "oi", "nhe", "nha", "minh", "ban", "em", "anh", "chi", "cho", "xem", "voi", "la", "ay", "do", "nay",
  "kia", "muon", "mua", "tim", "hoi", "duoc", "bao", "nhieu", "tien", "gia", "va", "hay", "hoac", "di",
]);

// "Quần bò" -> "quan jean": folded, punctuation and underscores to spaces, synonyms applied.
export function canonical(text: string): string {
  let s = ` ${fold(text).replace(/[^a-z0-9]+/g, " ").trim()} `;
  for (const [from, to] of SYNONYMS) s = s.replaceAll(` ${from} `, ` ${to} `);
  return s.trim().replace(/\s+/g, " ");
}

// "so mi" and "somi" both become "somi" via canonical, so "sơ mi" in a product
// name still matches "somi" typed by a shopper.
export function words(text: string): string[] {
  return canonical(text).split(" ").filter(Boolean);
}

export type Matchable = { name: string; category: string | null };
export type Match = "exact" | "close" | "none";

function haystack(p: Matchable): string[] {
  return words(`${p.name} ${p.category ?? ""}`);
}

const contains = (hay: string[], word: string) => hay.some((h) => h === word || (word.length >= 3 && h.startsWith(word)));

// The shop's products ranked against a search query.
//   exact: every query word is in the name or category (any order, no diacritics).
//   close: no exact match, but products share at least half of the query's words
//          (at least one); best first.
//   none:  nothing shares a word.
export function rankProducts<T extends Matchable>(query: string, products: T[], limit: number): { match: Match; products: T[] } {
  const q = words(query);
  if (q.length === 0) return { match: "none", products: [] };
  const scored = products.map((p) => {
    const hay = haystack(p);
    return { p, hits: q.filter((w) => contains(hay, w)).length };
  });
  const exact = scored.filter((s) => s.hits === q.length).map((s) => s.p);
  if (exact.length > 0) return { match: "exact", products: exact.slice(0, limit) };
  const need = Math.max(1, Math.ceil(q.length / 2));
  const close = scored
    .filter((s) => s.hits >= need)
    .sort((x, y) => y.hits - x.hits || x.p.name.localeCompare(y.p.name, "vi"))
    .map((s) => s.p);
  return close.length > 0 ? { match: "close", products: close.slice(0, limit) } : { match: "none", products: [] };
}

// Words that name a kind of garment: they say which group, not which occasion.
const GARMENT = new Set(["ao", "vay", "quan", "chan", "khoac", "do", "dam"]);

// Products whose description fits what the shopper asked for by occasion or
// style ("đồ đi tiệc", "đồ công sở"): words of 3+ letters from the message found
// in the description. Best first, at most `limit`. Used only to suggest cards
// next to the shop's groups, never as an answer about a product.
export function productsForOccasion<T extends Matchable & { description?: string | null }>(
  message: string,
  products: T[],
  limit: number,
): T[] {
  const said = [...new Set(words(message))].filter((w) => w.length >= 3 && !NOISE.has(w) && !GARMENT.has(w));
  if (said.length === 0) return [];
  return products
    .map((p) => {
      const desc = new Set(words(p.description ?? ""));
      return { p, hits: said.filter((w) => desc.has(w)).length };
    })
    .filter((s) => s.hits >= 1)
    .sort((x, y) => y.hits - x.hits || x.p.name.localeCompare(y.p.name, "vi"))
    .slice(0, limit)
    .map((s) => s.p);
}

// Products a shopper's free-text message seems to be about, for "Ý bạn là A hay
// B?" when the router found no product. A product counts when at least two of its
// name/category words, and half of them, appear in the message (one word like
// "áo" fits half the shop). Best first, at most `limit`.
export function productsNamedIn<T extends Matchable>(message: string, products: T[], limit: number): T[] {
  const said = new Set(words(message).filter((w) => !NOISE.has(w)));
  if (said.size === 0) return [];
  return products
    .map((p) => {
      const own = [...new Set(haystack(p))].filter((w) => !NOISE.has(w));
      return { p, hits: own.filter((w) => said.has(w)).length, size: own.length };
    })
    // Two words, and at least half of the product's own words: "áo … dài" is
    // not "Áo len mỏng tay dài".
    .filter((s) => s.hits >= 2 && s.hits * 2 >= s.size)
    .sort((x, y) => y.hits - x.hits || x.p.name.localeCompare(y.p.name, "vi"))
    .slice(0, limit)
    .map((s) => s.p);
}

// PB-31: "shop có gì", "bên mình có những sản phẩm gì": the whole catalog, not one
// product. "áo này có màu gì" names a product and a property, so it isn't. The
// question must END there (only particles after "gì/nào"): "shop có gì khuyến
// mãi", "có món gì phối với…", "có hàng nào size S" and "shop có gì đó sai rồi"
// ask something else. It runs before Jev, so it errs toward "not a catalog question".
const ENDS = "(gi|nao)( (vay|the|a|nhi|khong|ha|nha|nhe|shop|ban|ah|day))*$";
const CATALOG_QUESTION = [
  new RegExp(`\\b(shop|ben minh|ben ban|ben em|ben shop|cua hang)\\s+(co|ban)\\s+(nhung\\s+)?${ENDS}`),
  new RegExp(`\\b(co|ban)\\s+(nhung\\s+)?(san pham|mon|mat hang|loai do|do|hang)\\s+${ENDS}`),
];
export function isCatalogQuestion(text: string): boolean {
  const t = fold(text).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return CATALOG_QUESTION.some((re) => re.test(t));
}

// PB-31: exchanges and returns after buying ("mua về mặc không vừa thì đổi được
// không"): the doi_tra policy answers them. "đổi màu khác", "đổi sang áo khác" or
// "đổi lại địa chỉ" happen before buying, and "đổi" without diacritics is also
// "đợi"/"đôi", so "đổi"/"trả" counts only with a sign the item was bought.
const RETURNS = /\b(doi tra|tra hang|tra lai hang|hoan tien|doi size)\b/;
const AFTER_BUYING = /\b(mua ve|nhan hang|nhan duoc|khong vua|da mua|bi rong|bi chat|chat qua|rong qua)\b/;
export function isReturnsQuestion(text: string): boolean {
  const t = fold(text).replace(/[^a-z0-9]+/g, " ");
  return RETURNS.test(t) || (/\b(doi|tra)\b/.test(t) && AFTER_BUYING.test(t));
}
