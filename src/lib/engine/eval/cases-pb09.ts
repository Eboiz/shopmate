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
    shouldHandOff: false,
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
    // PB-31 soft handoff: offers staff instead of handing off (the handoff_to_staff
    // call with an offer reason is turned into the offer and not logged).
    description: "PB-09 AC2: 'ship miễn phí không?' with no shipping text -> offer staff; the reply mentions staff.",
    shouldHandOff: true,
    history: shopper("ship miễn phí không?"),
    expected: [
      { tool: "get_policy", args: { kind: "giao_hang" }, required: true },
      // Free shipping can read as a promotion too.
      { tool: "get_policy", args: { kind: "khuyen_mai" }, required: false },
      { tool: "handoff_to_staff", args: { reason: notCovered }, required: false },
    ],
    outcome: [
      { decision: "offer", reason: "policy_not_covered" },
      { decision: "offer", reason: "not_covered_by_data" },
    ],
    reply: { label: "mentions staff", ok: (t) => fold(t).includes("nhan vien") && noUnbackedDiscount(t) },
  },
  {
    id: "pb09-discount-ask",
    // Prompt v1.2 (PB-17): refused and kept with the AI, no handoff.
    description: "PB-09 AC3: a plain request to knock the price down; refused politely, no handoff, no discount offered.",
    shouldHandOff: false,
    history: shopper("Mình lấy 2 cái váy này, shop bớt cho mình 50k được không?"),
    productId: V,
    expected: [
      { tool: "get_policy", args: { kind: "khuyen_mai" }, required: false },
      { tool: "get_stock", args: { productId: V }, required: false },
      { tool: "quote_order", required: false },
    ],
    handoff: null,
    reply: {
      label: "refuses politely, offers or agrees to no discount",
      ok: (t) => {
        const text = fold(t);
        // "ưu đãi": the server's own refusal (REFUSAL_TEXT, PB-17) also counts.
        return noUnbackedDiscount(t) && text.includes("khong") && ["giam", "bot", "uu dai"].some((w) => text.includes(w));
      },
    },
  },
  {
    // PB-38 (test report 12/11, BOT-03): the word list took "giao sai màu" for a
    // complaint and handed off before any model call. On the seeded shop the
    // returns text answers it all (shipping paid by the shop when it sent the
    // wrong item; exchange only, no refund). Shop A's doi_tra only says "Đổi
    // trong 7 ngày", so here the right result is that part plus an offer of
    // staff (PB-31, policy_not_covered), never a complaint handoff.
    id: "pb38-hypothetical-wrong-color",
    description:
      "PB-38: hypothetical 'nếu shop giao sai màu' asked before buying -> answered from get_policy doi_tra " +
      "(7 ngày) with a staff offer for the part shop A's text doesn't cover; not a complaint handoff.",
    shouldHandOff: true,
    history: shopper(
      "Tôi chưa đặt hàng. Nếu nhận áo bị shop giao sai màu thì tôi có phải trả phí ship đổi không? Có được hoàn tiền không?",
    ),
    expected: [
      { tool: "get_policy", args: { kind: "doi_tra" }, required: true },
      { tool: "get_policy", args: { kind: "giao_hang" }, required: false },
      { tool: "handoff_to_staff", args: { reason: notCovered }, required: false },
    ],
    outcome: { decision: "offer", reason: "policy_not_covered" },
    reply: {
      label: "says 7 ngày and mentions staff, no discount",
      ok: (t) => fold(t).includes("7 ngay") && fold(t).includes("nhan vien") && noUnbackedDiscount(t),
    },
  },
];
