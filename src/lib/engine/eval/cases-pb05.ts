// PB-05 (stock and price answers) eval cases on top of cases.ts: the acceptance
// criteria as the shopper words them, with and without diacritics. Kept in their
// own file so the PB-05/06/09 additions merge without touching the same lines.
import type { HistoryMessage } from "@/contract";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase } from "./cases";

const V = FX.a.vay01; // "Váy suông linen", 350000: M be 2, L be 0, M đen 5
const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
const foldedIncludes = (part: string) => (v: unknown) => typeof v === "string" && fold(v).includes(part);
const foldedIs = (want: string) => (v: unknown) => typeof v === "string" && fold(v) === want;
// "350.000đ", "350,000", "350000", "350k" all count as the price 350000.
const saysPrice = (vnd: number) => (text: string) => {
  const t = fold(text).replace(/[.,\s]/g, "");
  return t.includes(String(vnd)) || t.includes(`${vnd / 1000}k`);
};
const saysSize = (size: string) => (text: string) =>
  new RegExp(`(^|[^a-z0-9])${size.toLowerCase()}([^a-z0-9]|$)`).test(fold(text));
const saysSoldOut = (text: string) => /het hang|da het|het size|het mau|het roi|tam het/.test(fold(text));
const available = { label: "says available + 350000 from data", ok: (t: string) => saysPrice(350000)(t) && !saysSoldOut(t) };

export const pb05EvalCases: EvalCase[] = [
  {
    id: "pb05-ac1-exact",
    description: 'PB-05 AC1 in its own words: "váy này màu be size M còn không?" (stock 2) -> available, price from data.',
    history: shopper("váy này màu be size M còn không?"),
    productId: V,
    expected: [{ tool: "get_stock", args: { productId: V, size: "M", color: foldedIs("be") }, required: true }],
    handoff: null,
    reply: available,
  },
  {
    id: "pb05-no-diacritics-by-name",
    description: "PB-05 AC1 + AC4: no product on screen, typed without diacritics; find it by name, then its stock.",
    history: shopper("vay suong linen mau be size M con khong shop?"),
    expected: [
      { tool: "search_products", args: { query: foldedIncludes("linen") }, required: true },
      { tool: "get_stock", args: { productId: V, size: "M", color: foldedIs("be") }, required: true },
    ],
    handoff: null,
    reply: available,
  },
  {
    id: "pb05-ac2-no-diacritics",
    description: "PB-05 AC2 typed without diacritics: beige / L is 0; say sold out and offer size M of the same dress.",
    history: shopper("vay nay mau be size L con ko shop"),
    productId: V,
    expected: [{ tool: "get_stock", args: { productId: V }, required: true }],
    handoff: null,
    reply: { label: "says sold out + offers size M", ok: (t) => saysSoldOut(t) && saysSize("M")(t) },
  },
  {
    id: "pb05-ac3-no-diacritics",
    description: "PB-05 AC3 first miss, typed without diacritics: one clarifying question, no guess, no handoff.",
    history: shopper("shop co ao khoac da khong"),
    expected: [{ tool: "search_products", args: { query: foldedIncludes("khoac") }, required: true }],
    handoff: null,
    reply: { label: "asks one question", ok: (t) => (t.match(/\?/g) ?? []).length === 1 },
  },
];
