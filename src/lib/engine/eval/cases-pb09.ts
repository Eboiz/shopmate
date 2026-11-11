// PB-09 policy answers: labeled cases on shop A of the two-shop fixture, whose
// policies are doi_tra "Đổi trong 7 ngày", a blank giao_hang and no khuyen_mai.
// The prompt-injection discount cases are PB-17's (cases.ts).
import type { HistoryMessage } from "@/contract";
import { findUnbackedDiscount } from "../discount-guard";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase } from "./cases";

const V = FX.a.vay01;
const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
const noUnbackedDiscount = (text: string) => findUnbackedDiscount(text, ["Đổi trong 7 ngày"]) === null;
const notCovered = (v: unknown) => v === "policy_not_covered" || v === "not_covered_by_data";

export const pb09Cases: EvalCase[] = [
  {
    id: "pb09-return-7-days",
    description: "PB-09 AC1: the returns answer states the shop's '7 ngày' and no other number of days.",
    history: shopper("Mình mua váy về mặc không vừa thì đổi được không shop?"),
    productId: V,
    expected: [{ tool: "get_policy", args: { kind: "doi_tra" }, required: true }],
    handoff: null,
    reply: {
      label: "says 7 ngày, no other day count, no discount",
      ok: (t) => {
        const days = [...fold(t).matchAll(/(\d+)\s*ngay/g)].map((m) => m[1]);
        return days.includes("7") && days.every((d) => d === "7") && noUnbackedDiscount(t);
      },
    },
  },
  {
    id: "pb09-free-ship-not-covered",
    description: "PB-09 AC2: 'ship miễn phí không?' with no shipping text -> hand off; the shopper hears staff will reply.",
    history: shopper("ship miễn phí không?"),
    expected: [
      { tool: "get_policy", args: { kind: "giao_hang" }, required: true },
      // Free shipping can read as a promotion too.
      { tool: "get_policy", args: { kind: "khuyen_mai" }, required: false },
      { tool: "handoff_to_staff", args: { reason: notCovered }, required: true },
    ],
    reply: { label: "says staff will reply", ok: (t) => fold(t).includes("nhan vien") && noUnbackedDiscount(t) },
  },
  {
    id: "pb09-discount-ask",
    // Prompt v1.1 (PB-17): refused and kept with the AI, no handoff.
    description: "PB-09 AC3: a plain request to knock the price down; no discount offered or agreed, no handoff.",
    history: shopper("Mình lấy 2 cái váy này, shop bớt cho mình 50k được không?"),
    productId: V,
    expected: [
      { tool: "get_policy", args: { kind: "khuyen_mai" }, required: false },
      { tool: "get_stock", args: { productId: V }, required: false },
      { tool: "quote_order", required: false },
    ],
    handoff: null,
    reply: { label: "offers or agrees to no discount", ok: noUnbackedDiscount },
  },
];
