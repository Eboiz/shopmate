// PB-07: every price and stock quantity in a model-written reply must be one a
// tool returned in the same turn. Pure: no IO. The engine rewrites once on a
// mismatch, then sends a product card and hands off (engine.ts).
import type { ToolCallLog } from "@/contract";

export type NumberIssue = { kind: "price" | "stock"; raw: string; value: number };

export const NUMBER_RETRY_NOTE =
  "Câu trả lời có giá hoặc số lượng tồn kho không khớp dữ liệu tool. Viết lại, chỉ dùng đúng giá và số lượng tool trả về.";

export const NUMBER_HANDOFF_TEXT =
  "Dạ, mình gửi bạn thông tin sản phẩm từ dữ liệu của shop. Nhân viên shop sẽ kiểm tra và trả lời bạn sớm nhé!";

// "\b" in a JS regex only knows ASCII letters, so "350.000đ" followed by a space
// would not end a word. Unicode look-arounds stand in for it: a number starts
// after a non-letter/digit, a unit ends before one ("58kg" is not "58k").
const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}.,])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{N}])`;

const PRICE_RE = new RegExp(
  String.raw`${NOT_WORD_BEFORE}(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghìn|ngàn|đ|đồng|vnđ)${NOT_WORD_AFTER}`,
  "giu",
);
const STOCK_RE = new RegExp(String.raw`còn\s+(\d+)\s*(?:cái|chiếc|sp|sản phẩm)?${NOT_WORD_AFTER}|\((?:còn\s*)?(\d+)\)`, "giu");

const THOUSANDS = new Set(["k", "nghìn", "ngàn"]);

type Found = { raw: string; value: number };

function pricesIn(text: string): Found[] {
  return [...text.matchAll(PRICE_RE)].map((m) => {
    const digits = Number(m[1].replace(/[.,]/g, ""));
    return { raw: m[0].trim(), value: THOUSANDS.has(m[2].toLowerCase()) ? digits * 1000 : digits };
  });
}

function stocksIn(text: string): Found[] {
  return [...text.matchAll(STOCK_RE)].map((m) => ({ raw: m[0].trim(), value: Number(m[1] ?? m[2]) }));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const nums = (...vs: unknown[]) => vs.filter((v): v is number => typeof v === "number");
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

// The prices and stock quantities tools returned this turn (ok logs only).
function allowed(logs: readonly ToolCallLog[]): { prices: Set<number>; stocks: Set<number> } {
  const prices = new Set<number>();
  const stocks = new Set<number>();
  for (const log of logs) {
    if (log.error !== undefined || !isObj(log.output)) continue;
    const out = log.output;
    switch (log.name) {
      case "search_products":
        for (const p of list(out.products)) nums(p.price).forEach((n) => prices.add(n));
        break;
      case "get_stock":
        nums(out.price).forEach((n) => prices.add(n));
        for (const v of list(out.variants)) nums(v.stock).forEach((n) => stocks.add(n));
        break;
      case "get_pairings":
        for (const p of list(out.pairings)) nums(p.price).forEach((n) => prices.add(n));
        break;
      case "quote_order":
        nums(out.total).forEach((n) => prices.add(n));
        for (const l of list(out.lines)) nums(l.unitPrice, l.lineTotal).forEach((n) => prices.add(n));
        break;
      case "create_draft_order":
        nums(out.total).forEach((n) => prices.add(n));
        break;
      case "get_policy":
        if (typeof out.content === "string") pricesIn(out.content).forEach((p) => prices.add(p.value));
        break;
    }
  }
  return { prices, stocks };
}

// Prices and stock quantities in the reply that no tool returned this turn.
// Measurements ("1m65", "58kg") and size names never match the patterns; an
// amount the shopper wrote ("bớt 50k") is not a promise, so it is not checked.
export function findUncheckedNumbers(
  reply: string,
  logs: readonly ToolCallLog[],
  latestShopperText: string,
): NumberIssue[] {
  const { prices, stocks } = allowed(logs);
  const shopperAmounts = new Set(pricesIn(latestShopperText).map((p) => p.value));
  return [
    ...pricesIn(reply)
      .filter((p) => !prices.has(p.value) && !shopperAmounts.has(p.value))
      .map((p) => ({ kind: "price" as const, ...p })),
    ...stocksIn(reply)
      .filter((s) => !stocks.has(s.value))
      .map((s) => ({ kind: "stock" as const, ...s })),
  ];
}
