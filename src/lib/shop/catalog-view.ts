// How the shop page groups, searches and labels products. Pure functions, so
// the same rules run on the server, in the browser and in unit tests.

export const PRODUCT_GROUPS = ["Áo", "Áo khoác", "Váy & đầm", "Chân váy", "Quần"] as const;
export const OTHER_GROUP = "Khác";
export type ProductGroup = (typeof PRODUCT_GROUPS)[number] | typeof OTHER_GROUP;

// Lower case, no diacritics, đ → d: "Đầm Đỏ" and "dam do" compare equal.
export function foldVietnamese(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Categories are free text: the PO sheet uses slugs (vay, chan_vay, ao_khoac),
// older rows use words (Đầm, Áo thun, Quần jean). Both map to five groups.
function groupOf(text: string): ProductGroup | null {
  const folded = foldVietnamese(text.replace(/[_-]+/g, " "));
  if (folded.startsWith("ao khoac")) return "Áo khoác";
  if (folded.startsWith("chan vay")) return "Chân váy";
  if (folded.startsWith("vay") || folded.startsWith("dam")) return "Váy & đầm";
  if (folded.startsWith("ao")) return "Áo";
  if (folded.startsWith("quan")) return "Quần";
  return null;
}

export function productGroup(category: string | null | undefined, name = ""): ProductGroup {
  return (category && groupOf(category)) || groupOf(name) || OTHER_GROUP;
}

export function groupRank(group: ProductGroup): number {
  const index = (PRODUCT_GROUPS as readonly string[]).indexOf(group);
  return index === -1 ? PRODUCT_GROUPS.length : index;
}

// Shop page filters live in the URL (?nhom=vay&tim=linen&size=M&sap-xep=gia-tang),
// so reload, back/forward and a shared link show the same list.
export type ShopSort = "group" | "price-asc" | "price-desc";
export type ShopFilters = { group: ProductGroup | ""; search: string; size: string; sort: ShopSort };

const GROUP_SLUGS: Record<ProductGroup, string> = {
  "Áo": "ao",
  "Áo khoác": "ao-khoac",
  "Váy & đầm": "vay",
  "Chân váy": "chan-vay",
  "Quần": "quan",
  "Khác": "khac",
};
const SORT_SLUGS: Record<Exclude<ShopSort, "group">, string> = { "price-asc": "gia-tang", "price-desc": "gia-giam" };
const SORT_BY_SLUG: Record<string, ShopSort> = { "gia-tang": "price-asc", "gia-giam": "price-desc" };
const FILTER_KEYS = ["nhom", "tim", "size", "sap-xep"];

export function searchFromQuery(params: Pick<URLSearchParams, "get">): string {
  return params.get("tim") ?? "";
}

// Values the shop can't show (unknown slug, a group or size it has none of) read as "all".
export function readShopFilters(
  params: Pick<URLSearchParams, "get">,
  available: { groups: readonly ProductGroup[]; sizes: readonly string[] },
): ShopFilters {
  const groupParam = params.get("nhom");
  const sortParam = params.get("sap-xep") ?? "";
  const sizeParam = params.get("size") ?? "";
  return {
    group: available.groups.find((group) => GROUP_SLUGS[group] === groupParam) ?? "",
    search: searchFromQuery(params),
    size: available.sizes.includes(sizeParam) ? sizeParam : "",
    sort: Object.hasOwn(SORT_BY_SLUG, sortParam) ? SORT_BY_SLUG[sortParam] : "group",
  };
}

// "?…" for the given filters, keeping any other parameter of `current`; "" when nothing is left.
export function shopFilterQuery(filters: ShopFilters, current: URLSearchParams): string {
  const params = new URLSearchParams(current);
  for (const key of FILTER_KEYS) params.delete(key);
  if (filters.group) params.set("nhom", GROUP_SLUGS[filters.group]);
  if (filters.search.trim()) params.set("tim", filters.search);
  if (filters.size) params.set("size", filters.size);
  if (filters.sort !== "group") params.set("sap-xep", SORT_SLUGS[filters.sort]);
  const query = params.toString();
  return query ? `?${query}` : "";
}

// Every word of the query must appear somewhere in the fields, in any order.
export function matchesQuery(fields: Array<string | null | undefined>, query: string): boolean {
  const words = foldVietnamese(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldVietnamese(fields.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

// "xanh rêu" → "Xanh rêu", so colors read the same however they were typed.
export function displayColor(color: string): string {
  const trimmed = color.trim();
  return trimmed ? trimmed[0].toLocaleUpperCase("vi") + trimmed.slice(1) : trimmed;
}

// Sizes already in order: ["S", "M", "L"] → "S–L".
export function sizeRange(sizes: string[]): string {
  if (sizes.length === 0) return "";
  return sizes.length === 1 ? sizes[0] : `${sizes[0]}–${sizes[sizes.length - 1]}`;
}

// The opening sentence of a policy, for short summaries.
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[\s\S]+?[.!?](?=\s|$)/.exec(trimmed);
  return (match ? match[0] : trimmed).trim();
}
