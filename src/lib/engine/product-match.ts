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

// PB-31 r2: Jev picked no product, but every product word of the message
// (synonyms applied, the product's own colors allowed) fits exactly ONE product:
// "Shop có quần bò không?" is the shop's "Quần jean ống đứng". Several fits or a
// word the shop doesn't have ("áo khoác da"): null, the caller asks which one.
export function productCoveringMessage<T extends Matchable & { colors?: string[] }>(message: string, products: T[]): T | null {
  const said = [...new Set(words(message).filter((w) => !NOISE.has(w)))];
  if (said.length === 0) return null;
  const fits = products.filter((p) => {
    const own = [...haystack(p), ...(p.colors ?? []).flatMap(words)];
    return said.every((w) => contains(own, w));
  });
  return fits.length === 1 ? fits[0] : null;
}

// PB-31: "shop có gì", "bên mình có những sản phẩm gì": the whole catalog. The
// WHOLE message must be that question (r2): only a shop subject may come before
// "có/bán" and only particles after "gì/nào", so "Váy đen có hàng nào không",
// "Size M có hàng nào", "shop có gì khuyến mãi" or "shop có gì đó sai rồi" ask
// something else. It runs before Jev, so it errs toward "not a catalog question".
const CATALOG_QUESTION = new RegExp(
  "^((hien tai|cho minh hoi|cho hoi|oi|da|vay|the) )*((shop|ben minh|ben ban|ben em|ben shop|cua hang|minh) )?(hien )?(dang )?" +
    "(co|ban) (nhung )?((san pham|mon|mon do|mat hang|loai do|loai hang|do|hang) )?(gi|nao)" +
    "( (vay|the|a|nhi|khong|ha|nha|nhe|shop|ban|ah|day|z))*$",
);
export function isCatalogQuestion(text: string): boolean {
  return CATALOG_QUESTION.test(fold(text).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim());
}

// PB-31: exchanges and returns after buying ("mua về mặc không vừa thì đổi được
// không"): the doi_tra policy answers them. Matched on the text WITH diacritics
// (r2): without them "đổi"/"trả" collide with "đợi", "đôi", "trả lời". A bare
// "đổi"/"trả" needs a sign the item was bought; "đổi size sang M" while ordering
// or "rộng quá không" before buying is not a return.
const word = (alts: string) => new RegExp(`(?<!\\p{L})(${alts})(?!\\p{L})`, "u");
const RETURNS = word("đổi trả|trả hàng|trả lại (hàng|đồ|áo|váy|quần|tiền)|hoàn tiền|đổi hàng");
const RETURNS_PLAIN = /\b(doi tra|tra hang|hoan tien)\b/;
const RETURN_VERB = word("đổi|trả");
const AFTER_BUYING = word("mua về|nhận hàng|nhận được hàng|đã mua|(mặc|mang) (không|ko|k) vừa");
const AFTER_BUYING_PLAIN = /\b(mua ve|nhan hang|nhan duoc hang|da mua|mac (khong|ko|k) vua)\b/;
export function isReturnsQuestion(text: string): boolean {
  const t = text.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
  const plain = fold(text).replace(/[^a-z0-9]+/g, " ");
  if (RETURNS.test(t) || RETURNS_PLAIN.test(plain)) return true;
  // Typed without diacritics: the folded words are all there is to go on.
  const noMarks = !/[^\x00-\x7f]/.test(t);
  const verb = RETURN_VERB.test(t) || (noMarks && /\b(doi|tra)\b/.test(plain));
  return verb && (AFTER_BUYING.test(t) || AFTER_BUYING_PLAIN.test(plain));
}

// PB-39: shipping and delivery ("phí ship bao nhiêu?", "ship bao lâu thì nhận",
// "phi van chuyen", "có freeship không"): the giao_hang policy answers them,
// whatever the earlier turns were about. Folded text: none of these words collide.
const SHIPPING = /\b(ship|shipping|freeship|giao hang|van chuyen|phi giao)\b/;
// The same message also asks about a product's stock, size or color: not a
// shipping-only question ("váy này còn size M không, ship được không").
const ABOUT_A_PRODUCT = /\bcon (hang|size|mau|khong|ko|k)\b|\bsize\b|\bmau\b/;
export function isShippingQuestion(text: string): boolean {
  const plain = fold(text).replace(/[^a-z0-9]+/g, " ");
  return SHIPPING.test(plain) && !ABOUT_A_PRODUCT.test(plain) && !isReturnsQuestion(text);
}

// PB-39: the message asks for the price or what is in stock ("báo giá, màu còn
// hàng", "giá bao nhiêu"), next to a size question.
const PRICE_OR_STOCK = /\b(gia|bao gia|bao nhieu tien)\b|\bcon (hang|mau|size|khong|ko)\b|\bmau (nao|gi)\b|\bmau con\b|\bton kho\b/;
export const asksPriceOrStock = (text: string) => PRICE_OR_STOCK.test(fold(text).replace(/[^a-z0-9]+/g, " "));
