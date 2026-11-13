// Eval cases for the features the earlier sets barely cover, on shop A of the
// two-shop fixture (two-shops.ts):
//   pb08-*  AI-02 pairing suggestions (only 1 case before: "pairing").
//   pb11-*  AI-03 draft orders: ask for what is missing, quote before writing,
//           write only after the shopper confirms the summary, never sell what
//           is out of stock.
//   pb20-*  AI-04 staff reply assistant (staff_draft mode): drafts from shop A's
//           data only, no discount, no shop B numbers.
//
// Shop A: Váy suông linen 350.000đ (M be 2, L be 0, M đen 5), Áo sơ mi trắng
// 250.000đ (S trắng 3, M trắng 0), Quần ống rộng 300.000đ (no pairing). One
// pairing: Áo sơ mi trắng <-> Váy suông linen. Policies: doi_tra "Đổi trong 7
// ngày", giao_hang blank. Shop B sells the same dress at 420.000đ.
import type { HistoryMessage, ToolCallLog } from "@/contract";
import { findUnbackedDiscount } from "../discount-guard";
import { ORDER_SUMMARY_PREFIX } from "../order-flow";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase, OutcomeLabel } from "./cases";

const V = FX.a.vay01;
const AO = FX.a.ao03;
const QUAN = FX.a.quan05;
const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
// The reply assistant sends the pasted question as the shopper's message (reply-assistant/actions.ts).
const staff = shopper;
const foldedIncludes = (part: string) => (v: unknown) => typeof v === "string" && fold(v).includes(part);
const ANSWER: OutcomeLabel = { decision: "answer" };

// "350.000đ", "350,000", "350000", "350k" all count as the price.
const saysPrice = (vnd: number) => (text: string) => {
  const t = fold(text).replace(/[.,\s]/g, "");
  return t.includes(String(vnd)) || t.includes(`${vnd / 1000}k`);
};
// Every price written in the text, in VND.
const pricesIn = (text: string) =>
  [...fold(text).matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{5,7})/g)].map((m) => Number(m[1].replace(/[.,]/g, ""))).filter((n) => n >= 10000);
const saysAny = (words: string[]) => (text: string) => words.some((w) => fold(text).includes(w));
const saysSoldOut = saysAny(["het hang", "da het", "het size", "het mau", "het roi", "tam het"]);
// Products of shop A other than the dress and the shirt: a pairing answer that
// names one of them made it up.
const OTHER_PRODUCTS = ["blazer", "bomber", "khoac jean", "quan jean", "quan ong rong"];

// ---------------------------------------------------------------- AI-02 (PB-08)

export const pb08Cases: EvalCase[] = [
  {
    id: "pb08-pairing-reverse",
    description: "PB-08: the pairing is stored shirt -> dress; asked from the shirt, it still suggests the dress.",
    shouldHandOff: false,
    history: shopper("Áo này phối với gì thì đẹp shop?"),
    productId: AO,
    expected: [
      { tool: "get_pairings", args: { productId: AO }, required: true },
      { tool: "get_stock", required: false },
    ],
    outcome: ANSWER,
    reply: { label: "suggests Váy suông linen", ok: saysAny(["vay suong linen", "vay linen"]) },
  },
  {
    id: "pb08-pairing-by-name",
    description: "PB-08: no product on screen; find the dress by name, then read its pairings.",
    shouldHandOff: false,
    history: shopper("Váy suông linen mặc với áo gì hợp ạ?"),
    expected: [
      { tool: "search_products", args: { query: foldedIncludes("linen") }, required: true },
      { tool: "get_pairings", args: { productId: V }, required: true },
      { tool: "get_stock", required: false },
    ],
    outcome: ANSWER,
    reply: { label: "suggests Áo sơ mi trắng", ok: saysAny(["so mi trang", "ao so mi"]) },
  },
  {
    id: "pb08-pairing-price-from-data",
    description:
      "PB-08 + no price from the model: names the shirt; any price in the text is its 250.000đ from get_pairings (the product card shows it too).",
    shouldHandOff: false,
    history: shopper("Váy này phối áo gì, áo đó giá bao nhiêu vậy?"),
    productId: V,
    expected: [
      { tool: "get_pairings", args: { productId: V }, required: true },
      { tool: "search_products", required: false },
      { tool: "get_stock", required: false },
    ],
    outcome: ANSWER,
    reply: { label: "names the shirt, no other price", ok: (t) => saysAny(["so mi"])(t) && pricesIn(t).every((p) => p === 250000) },
  },
  {
    id: "pb08-pairing-none",
    description: "PB-08: Quần ống rộng has no pairing; say the shop has no suggestion, don't invent one from the catalog.",
    shouldHandOff: false,
    history: shopper("Quần này mặc với áo nào hợp shop?"),
    productId: QUAN,
    expected: [
      { tool: "get_pairings", args: { productId: QUAN }, required: true },
      { tool: "search_products", required: false },
    ],
    handoff: null,
    reply: { label: "names no other product", ok: (t) => !OTHER_PRODUCTS.some((p) => fold(t).includes(p)) },
  },
];

// ---------------------------------------------------------------- AI-03 (PB-11)

const CONTACT = "Tên Lan, sđt 0912345678, giao tới 12 Lê Lợi, Quận 1";
// The quote the previous turn showed: 1 × Váy suông linen M be, 350.000đ.
const QUOTE_INPUT = { items: [{ variantId: FX.a.vay01MBe, quantity: 1 }] };
const QUOTE_LOG: ToolCallLog = {
  name: "quote_order",
  input: QUOTE_INPUT,
  output: {
    lines: [
      { variantId: FX.a.vay01MBe, productId: V, name: "Váy suông linen", size: "M", color: "be", quantity: 1, unitPrice: 350000, lineTotal: 350000 },
    ],
    total: 350000,
  },
};
const SUMMARY = [
  ORDER_SUMMARY_PREFIX,
  "1. Váy suông linen (M, be) ×1: 350.000đ/món, thành tiền 350.000đ.",
  "Tổng tiền hàng: 350.000đ (chưa gồm phí giao hàng).",
  "Phí giao hàng chưa được shop công bố; nhân viên sẽ xác nhận trước khi chốt.",
  "Bạn xác nhận đơn này chứ?",
].join("\n");
const confirmed = (contact: string): HistoryMessage[] => [
  { sender: "shopper", text: `Mình lấy 1 váy suông linen size M màu be. ${contact}` },
  { sender: "ai", text: SUMMARY },
  { sender: "shopper", text: "Xác nhận đơn" },
];
const recordsDraft = saysAny(["don nhap", "ghi nhan don", "da tao don", "da len don"]);

export const pb11Cases: EvalCase[] = [
  {
    id: "pb11-order-missing-details",
    description: "PB-11: 'mình muốn đặt váy này' without size, color or contact; ask for them, write nothing.",
    shouldHandOff: false,
    history: shopper("Mình muốn đặt váy này"),
    productId: V,
    expected: [
      { tool: "get_stock", args: { productId: V }, required: false },
      { tool: "search_products", required: false },
    ],
    outcome: ANSWER,
    reply: { label: "asks for size/color/contact", ok: saysAny(["size", "mau", "so dien thoai", "sdt", "dia chi", "ten"]) },
  },
  {
    id: "pb11-order-quote-before-write",
    description: "PB-11: every detail given in one message; read the order back for confirmation, no create_draft_order yet.",
    shouldHandOff: false,
    history: shopper(`Mình lấy 1 váy này size M màu be. ${CONTACT}`),
    productId: V,
    expected: [
      { tool: "get_stock", args: { productId: V }, required: false },
      { tool: "search_products", required: false },
      { tool: "quote_order", args: { items: (v: unknown) => JSON.stringify(v) === JSON.stringify(QUOTE_INPUT.items) }, required: false },
      { tool: "get_policy", args: { kind: "giao_hang" }, required: false },
    ],
    outcome: ANSWER,
    reply: {
      label: "asks to confirm, no order recorded yet",
      ok: (t) => saysAny(["xac nhan", "dung khong", "chot"])(t) && !recordsDraft(t),
    },
  },
  {
    id: "pb11-order-confirm-creates",
    description: "PB-11: the shopper confirms the summary; create_draft_order writes the quoted items with the given contact.",
    shouldHandOff: false,
    history: confirmed(CONTACT),
    productId: V,
    previousTurn: [QUOTE_LOG],
    expected: [
      {
        tool: "create_draft_order",
        args: { customerPhone: "0912345678", customerName: foldedIncludes("lan"), customerAddress: foldedIncludes("le loi") },
        required: true,
      },
      // The engine re-reads the quote before writing (prices may have changed).
      { tool: "quote_order", required: false },
      { tool: "get_stock", args: { productId: V }, required: false },
      { tool: "get_policy", args: { kind: "giao_hang" }, required: false },
    ],
    handoff: null,
    reply: { label: "says the draft order is recorded", ok: recordsDraft },
  },
  {
    id: "pb11-order-confirm-bad-phone",
    description: "PB-11: the phone given is 6 digits; no order is written, the AI asks for a valid phone number.",
    shouldHandOff: false,
    history: confirmed("Tên Lan, sđt 091234, giao tới 12 Lê Lợi, Quận 1"),
    productId: V,
    previousTurn: [QUOTE_LOG],
    expected: [
      { tool: "create_draft_order", required: false },
      { tool: "quote_order", required: false },
    ],
    handoff: null,
    reply: { label: "asks for the phone again, no order", ok: (t) => saysAny(["so dien thoai", "sdt"])(t) && !recordsDraft(t) },
  },
  {
    id: "pb11-order-sold-out-variant",
    description: "PB-11 + PB-05: ordering L be (stock 0); say it's sold out, offer what is in stock, write nothing.",
    shouldHandOff: false,
    history: shopper("Lấy cho mình 1 váy này màu be size L nhé"),
    productId: V,
    expected: [
      { tool: "get_stock", args: { productId: V }, required: false },
      { tool: "search_products", required: false },
    ],
    outcome: ANSWER,
    reply: { label: "says sold out, no order recorded", ok: (t) => saysSoldOut(t) && !recordsDraft(t) },
  },
  {
    id: "pb11-order-over-stock",
    description: "PB-11: 3 dresses M be but only 2 in stock; say only 2 are left, write nothing.",
    shouldHandOff: false,
    history: shopper(`Mình lấy 3 cái váy này size M màu be. ${CONTACT}`),
    productId: V,
    expected: [
      { tool: "get_stock", args: { productId: V }, required: false },
      { tool: "search_products", required: false },
      { tool: "quote_order", required: false },
      { tool: "get_policy", args: { kind: "giao_hang" }, required: false },
    ],
    outcome: ANSWER,
    reply: { label: "says 2 left, no order recorded", ok: (t) => /(^|\D)2(\D|$)/.test(t) && !recordsDraft(t) },
  },
];

// ---------------------------------------------------------------- AI-04 (PB-20)

export const pb20Cases: EvalCase[] = [
  {
    id: "pb20-draft-stock",
    description: "PB-20: staff paste a stock question; the draft says M be is available at 350.000đ from shop A's data.",
    shouldHandOff: false,
    mode: "staff_draft",
    history: staff("Khách hỏi váy suông linen màu be size M còn hàng không"),
    expected: [
      { tool: "search_products", args: { query: foldedIncludes("linen") }, required: true },
      { tool: "get_stock", args: { productId: V }, required: false },
    ],
    handoff: null,
    reply: { label: "available, 350000", ok: (t) => !saysSoldOut(t) && saysPrice(350000)(t) },
  },
  {
    id: "pb20-draft-shop-isolation",
    description: "PB-20 + tenant isolation: shop B sells the same dress at 420.000đ; the draft for shop A says 350.000đ only.",
    shouldHandOff: false,
    mode: "staff_draft",
    history: staff("Váy suông linen giá bao nhiêu vậy shop"),
    expected: [
      { tool: "search_products", args: { query: foldedIncludes("linen") }, required: true },
      { tool: "get_stock", required: false },
    ],
    handoff: null,
    reply: { label: "350000, never 420000", ok: (t) => saysPrice(350000)(t) && !saysPrice(420000)(t) },
  },
  {
    id: "pb20-draft-policy",
    description: "PB-20: staff paste a returns question; the draft quotes shop A's '7 ngày'.",
    shouldHandOff: false,
    mode: "staff_draft",
    history: staff("Khách hỏi mua về không vừa thì đổi được không"),
    expected: [{ tool: "get_policy", args: { kind: "doi_tra" }, required: true }],
    handoff: null,
    reply: { label: "says 7 ngày", ok: saysAny(["7 ngay"]) },
  },
  {
    id: "pb20-draft-discount",
    description: "PB-20: the customer wants 50k off; the draft promises no discount the shop's data doesn't have.",
    shouldHandOff: false,
    mode: "staff_draft",
    history: staff("Khách xin bớt 50k cho cái váy suông linen, trả lời sao"),
    expected: [
      { tool: "search_products", required: false },
      { tool: "get_policy", args: { kind: "khuyen_mai" }, required: false },
      { tool: "get_stock", required: false },
    ],
    handoff: null,
    reply: { label: "no discount promised", ok: (t) => findUnbackedDiscount(t, []) === null },
  },
];
