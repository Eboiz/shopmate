// Basic labeled cases for the engine (PB-03): did it call the right tools, with
// the right arguments, and only when needed? Small on purpose (shop A of the
// two-shop fixture); deeper sets come with PB-10.
import type { HistoryMessage, ToolName } from "@/contract";
import { fold } from "../text";
import { FX } from "../test/two-shops";

// Partial match: each key must match the input's value (=== or a function returning true).
export type ArgMatcher = Record<string, unknown | ((value: unknown) => boolean)>;
// required false: allowed, not needed.
export type ExpectedCall = { tool: ToolName; args?: ArgMatcher; required: boolean };
export type EvalCase = {
  id: string;
  description: string;
  history: HistoryMessage[]; // the last message is the shopper's
  productId?: string; // the product the shopper is looking at (an id in FX.a)
  expected: ExpectedCall[]; // [] means NO tool is needed
};

const V = FX.a.vay01;
const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
const foldedIncludes = (part: string) => (v: unknown) => typeof v === "string" && fold(v).includes(part);
const foldedIs = (want: string) => (v: unknown) => typeof v === "string" && fold(v) === want;

export const evalCases: EvalCase[] = [
  {
    id: "greeting-no-tool",
    description: "A greeting needs no tool.",
    history: shopper("Chào shop"),
    expected: [],
  },
  {
    id: "find-product",
    description: "Searches the catalog by name.",
    history: shopper("Shop có váy suông linen không?"),
    expected: [
      { tool: "search_products", args: { query: foldedIncludes("linen") }, required: true },
      { tool: "get_stock", args: { productId: V }, required: false },
    ],
  },
  {
    id: "stock-known-product",
    description: "Stock for the product being viewed, in the size and color asked.",
    history: shopper("Còn size M màu be không?"),
    productId: V,
    expected: [{ tool: "get_stock", args: { productId: V, size: "M", color: foldedIs("be") }, required: true }],
  },
  {
    id: "size-advice",
    description: "Height and weight go to recommend_size as whole numbers.",
    history: shopper("Mình cao 1m60 nặng 50kg thì mặc size nào?"),
    productId: V,
    expected: [
      { tool: "recommend_size", args: { productId: V, heightCm: 160, weightKg: 50 }, required: true },
      { tool: "get_stock", args: { productId: V }, required: false },
    ],
  },
  {
    id: "size-missing-info",
    description: "Without height and weight, ask instead of guessing numbers.",
    history: shopper("Mình mặc size nào được nhỉ?"),
    productId: V,
    expected: [],
  },
  {
    id: "pairing",
    description: "Suggestions come from the shop's pairings.",
    history: shopper("Váy này mặc với áo gì đẹp?"),
    productId: V,
    expected: [{ tool: "get_pairings", args: { productId: V }, required: true }],
  },
  {
    id: "return-policy",
    description: "Returns policy from the shop's own text.",
    history: shopper("Bên shop có cho đổi trả không?"),
    expected: [{ tool: "get_policy", args: { kind: "doi_tra" }, required: true }],
  },
  {
    id: "policy-not-in-data",
    description: "Shop A has no shipping text, so the question goes to staff.",
    history: shopper("Giao hàng mất mấy ngày vậy shop?"),
    expected: [
      { tool: "get_policy", args: { kind: "giao_hang" }, required: true },
      {
        tool: "handoff_to_staff",
        args: { reason: (v: unknown) => v === "policy_not_covered" || v === "not_covered_by_data" },
        required: true,
      },
    ],
  },
];
