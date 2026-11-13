// PB-40: what the shopper ruled out in their own words: a budget ("có 300
// nghìn", "dưới 300k"), a garment they don't want ("không thích váy") and how
// many items to suggest ("gợi ý 2 món"). The product cards of a reply are cut
// to fit them by the server, whatever the model picked. Pure: no IO.
import { productGroup, type ProductGroup } from "@/lib/shop/catalog-view";
import { fold } from "./text";

export type ShopperConstraints = {
  maxPrice: number | null;
  excludeGroups: ProductGroup[];
  count: number | null;
};

// What a card or catalog row needs to be checked; price missing = unknown.
export type ConstrainedItem = { name: string; category: string | null; price?: number | null };

// "trên 300k", "hơn 300k", "từ 300k": a minimum, not a budget.
const MINIMUM_BEFORE = /(?:^|\s)(?:tren|hon|tu)\s*$/;

function budget(t: string): number | null {
  const found: Array<{ at: number; vnd: number }> = [];
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:trieu|tr)(\d)?(?![a-z])/g)) {
    const millions = Number(m[1].replace(",", ".")) + (m[2] ? Number(m[2]) / 10 : 0);
    found.push({ at: m.index, vnd: Math.round(millions * 1_000_000) });
  }
  // "50kg" is a weight: the k must end the word.
  for (const m of t.matchAll(/(\d+)\s*(?:k|nghin|ngan)(?![a-z])/g)) found.push({ at: m.index, vnd: Number(m[1]) * 1000 });
  for (const m of t.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{5,})\s*(?:d|vnd|dong)?(?![a-z0-9])/g)) {
    found.push({ at: m.index, vnd: Number(m[1].replace(/[.,]/g, "")) });
  }
  const max = found
    .sort((a, b) => a.at - b.at)
    .find((f) => !MINIMUM_BEFORE.test(t.slice(Math.max(0, f.at - 8), f.at)));
  return max?.vnd ?? null;
}

const GARMENTS: Array<[string, ProductGroup[]]> = [
  ["chan vay", ["Chân váy"]],
  ["ao khoac", ["Áo khoác"]],
  ["vay", ["Váy & đầm", "Chân váy"]],
  ["dam", ["Váy & đầm"]],
  ["quan", ["Quần"]],
  ["ao", ["Áo", "Áo khoác"]],
];
const GARMENT = GARMENTS.map(([w]) => w).join("|");
const FILLER = "(?:\\s+(?:mac|lay|mua|do|kieu|mon|loai|cac|nhung))*";
const EXCLUDED = new RegExp(
  `(?:(?:^|\\s)(?:khong|ko|k|chang|cha|dung)\\s+(?:thich|muon|lay|mac|can|ua|chon|goi y)${FILLER}|(?:^|\\s)(?:ngoai tru|tru|bo qua))\\s+(${GARMENT})(?![a-z])`,
  "g",
);

function excluded(t: string): ProductGroup[] {
  const groups = new Set<ProductGroup>();
  for (const m of t.matchAll(EXCLUDED)) {
    for (const g of GARMENTS.find(([w]) => w === m[1])![1]) groups.add(g);
  }
  return [...groups];
}

const NUMBER_WORDS: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5 };
function count(t: string): number | null {
  const m = /(?:^|\s)([1-9]|mot|hai|ba|bon|nam)\s+(?:mon|mau|san pham|lua chon|bo)(?![a-z])/.exec(t);
  if (!m) return null;
  return NUMBER_WORDS[m[1]] ?? Number(m[1]);
}

export function shopperConstraints(text: string): ShopperConstraints {
  const t = fold(text).replace(/\s+/g, " ");
  return { maxPrice: budget(t), excludeGroups: excluded(t), count: count(t) };
}

export function hasConstraints(c: ShopperConstraints): boolean {
  return c.maxPrice !== null || c.excludeGroups.length > 0 || c.count !== null;
}

// The items that fit, in their order, at most `count`. An item whose price is
// unknown doesn't fit a budget.
export function fitConstraints<T extends ConstrainedItem>(items: T[], c: ShopperConstraints): T[] {
  const kept = items.filter(
    (p) =>
      !c.excludeGroups.includes(productGroup(p.category, p.name)) &&
      (c.maxPrice === null || (typeof p.price === "number" && p.price <= c.maxPrice)),
  );
  return c.count === null ? kept : kept.slice(0, c.count);
}

// BOT-02: quick replies naming a size (one of `sizes`, folded) other than the
// shopper's own are dropped, so a sold-out size never turns into "take L".
export function dropOtherSizeReplies(replies: string[], size: string | null, sizes: Set<string>): string[] {
  if (size === null) return replies;
  const own = fold(size);
  return replies.filter((r) => !fold(r).split(/[^a-z0-9]+/).some((w) => sizes.has(w) && w !== own));
}
