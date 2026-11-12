import { describe, expect, it } from "vitest";
import type { HistoryMessage, ToolCallLog } from "@/contract";
import {
  isContactOnly, isOrderConfirmation, isOrderIntent, latestQuote, missingCustomerDetails,
  orderCreatedText, orderOutOfStockText, orderSummary, orderWriteError, sameItems,
  sameQuote,
} from "./order-flow";

const PRODUCT = "a0000000-0000-4000-8000-000000000011";
const VARIANT = "a0000000-0000-4000-8000-000000000021";
const OTHER = "a0000000-0000-4000-8000-000000000022";
const quote = {
  lines: [{ variantId: VARIANT, productId: PRODUCT, name: "Váy suông linen", size: "M", color: "be", quantity: 2, unitPrice: 350000, lineTotal: 700000 }],
  total: 700000,
};
const items = [{ variantId: VARIANT, quantity: 2 }];
const details = { items, customerName: "Thảo", customerPhone: "0912345678", customerAddress: "12 Nguyễn Huệ, Q1" };
const history: HistoryMessage[] = [
  { sender: "shopper", text: "Mình lấy 2 váy size M màu be. Tên Thảo, SĐT 0912345678, địa chỉ 12 Nguyễn Huệ, Q1." },
  { sender: "ai", text: "Dạ, đơn hàng dự kiến:\n1. Váy...\nBạn xác nhận đơn này chứ?" },
  { sender: "shopper", text: "Dạ mình xác nhận nha" },
];

describe("PB-11 order flow", () => {
  it("reads only a validated quote from the tool log", () => {
    const logs: ToolCallLog[] = [
      { name: "quote_order", input: { items }, output: quote },
      { name: "quote_order", input: { items: [{ variantId: OTHER, quantity: 1 }] }, output: quote },
    ];
    expect(latestQuote(logs)).toEqual({ items, quote });
    expect(latestQuote([{ name: "quote_order", input: { items }, error: "internal_error" }])).toBeNull();
    expect(latestQuote([{ name: "quote_order", input: { items }, output: { lines: [], total: 0 } }])).toBeNull();
  });

  it("requires an explicit confirmation of the last shown summary", () => {
    expect(isOrderIntent(history)).toBe(true);
    expect(isOrderConfirmation(history)).toBe(true);
    for (const answer of ["Đúng rồi", "Dạ vâng ạ", "Chính xác"]) {
      expect(isOrderConfirmation([...history.slice(0, -1), { sender: "shopper", text: answer }])).toBe(true);
    }
    for (const answer of ["không", "chưa nhé", "ok nhưng đổi size L", "mình muốn 3 cái", "0912345678"]) {
      expect(isOrderConfirmation([...history.slice(0, -1), { sender: "shopper", text: answer }])).toBe(false);
    }
    expect(isOrderConfirmation([{ sender: "shopper", text: "xác nhận" }])).toBe(false);
  });

  it("isContactOnly: a phone or a contact field, with no order change", () => {
    expect(isContactOnly("0912 345 678")).toBe(true);
    expect(isContactOnly("SĐT 0912345678")).toBe(true);
    expect(isContactOnly("Size L nhé")).toBe(false);
    expect(isContactOnly("ok")).toBe(false);
  });

  it("lets contact details sit between the summary and the confirmation", () => {
    const summary = { sender: "ai", text: "Dạ, đơn hàng dự kiến:\n1. Váy...\nBạn xác nhận đơn này chứ?" } as const;
    const withBetween = (text: string, last = "ok") => isOrderConfirmation([
      { sender: "shopper", text: "Mình lấy 2 váy size M màu be." },
      summary,
      { sender: "shopper", text },
      { sender: "shopper", text: last },
    ]);
    expect(withBetween("Thảo, 0912345678, giao Q1")).toBe(true);
    expect(withBetween("Tên Thảo, địa chỉ 12 Nguyễn Trãi Q1")).toBe(true);
    // Names and addresses that contain order words are still contact details.
    expect(withBetween("Tên Huy, số 0912345678, giao Q1")).toBe(true);
    expect(withBetween("Tên Đạt, 0912345678")).toBe(true);
    expect(withBetween("Địa chỉ 12 Cái Lân, Hạ Long")).toBe(true);
    // ...but an explicit change inside a contact segment still voids it.
    expect(withBetween("Tên Thảo đổi sang size L")).toBe(false);
    // A phone number does not excuse a cancel in the same segment.
    expect(withBetween("0912345678 thôi không mua nữa")).toBe(false);
    expect(withBetween("SĐT 0912345678 thêm 10 cái")).toBe(false);
    expect(withBetween("Tên Thảo, bớt 12 cái")).toBe(false);
    expect(withBetween("Tên Thảo, lấy thêm cái nữa")).toBe(false);
    expect(withBetween("Địa chỉ 12 Cái Lân, thêm 1 váy")).toBe(false);
    expect(withBetween("SĐT 0912345678 thôi không mua nữa")).toBe(false);
    expect(withBetween("Thảo 0912345678")).toBe(true);
    // Contact details plus a change still void it; contact details are not a confirmation.
    expect(withBetween("Thảo 0912345678, mà đổi sang size L nhé")).toBe(false);
    expect(withBetween("0912345678 lấy thêm 1 cái")).toBe(false);
    expect(withBetween("Thảo, 0912345678, giao Q1", "Thảo, 0912345678, giao Q1")).toBe(false);
  });

  it("requires every shopper message after the summary to be a confirmation", () => {
    const summary = { sender: "ai", text: "Dạ, đơn hàng dự kiến:\n1. Váy...\nBạn xác nhận đơn này chứ?" } as const;
    // Shopper changes the order after the summary, then says "ok": a new summary is needed.
    expect(isOrderConfirmation([
      { sender: "shopper", text: "Mình lấy 2 váy size M màu be." },
      summary,
      { sender: "shopper", text: "Không lấy M nữa, đổi sang L" },
      { sender: "shopper", text: "ok" },
    ])).toBe(false);
    // A cancellation after the summary also invalidates the confirmation.
    expect(isOrderConfirmation([
      { sender: "shopper", text: "Mình lấy 2 váy size M màu be." },
      summary,
      { sender: "shopper", text: "thôi không mua nữa" },
      { sender: "shopper", text: "ok" },
    ])).toBe(false);
    // A burst of confirmations after the summary is still a confirmation.
    expect(isOrderConfirmation([
      { sender: "shopper", text: "Mình lấy 2 váy size M màu be." },
      summary,
      { sender: "shopper", text: "ok" },
      { sender: "shopper", text: "ok nha" },
    ])).toBe(true);
  });

  it("rejects a changed item or contact details not supplied by the shopper", () => {
    const previous = { items, quote };
    expect(orderWriteError(details, history, previous)).toBeNull();
    expect(orderWriteError({ ...details, items: [{ variantId: OTHER, quantity: 2 }] }, history, previous)).toEqual({ code: "order_items_changed" });
    expect(orderWriteError(details, history, null)).toEqual({ code: "confirmation_required" });
    expect(missingCustomerDetails({ ...details, customerAddress: "99 Đường B", customerPhone: "0999999999" }, history)).toEqual(["số điện thoại", "địa chỉ giao hàng"]);
    expect(orderWriteError({ ...details, customerName: "Mai" }, history, previous)).toEqual({ code: "customer_details_missing", missing: ["tên"] });
    expect(sameItems([{ variantId: VARIANT, quantity: 1 }, { variantId: VARIANT, quantity: 1 }], quote.lines)).toBe(true);
    expect(sameQuote(quote, quote)).toBe(true);
    expect(sameQuote(quote, { ...quote, lines: [{ ...quote.lines[0], unitPrice: 360000, lineTotal: 720000 }], total: 720000 })).toBe(false);
  });

  it("uses quoted unit prices, line totals and goods total; shipping stays separate", () => {
    const text = orderSummary(quote, "Phí nội thành 20.000đ; miễn phí từ 500.000đ.");
    expect(text).toContain("350.000đ/món");
    expect(text).toContain("thành tiền 700.000đ");
    expect(text).toContain("Tổng tiền hàng: 700.000đ (chưa gồm phí giao hàng)");
    expect(text).toContain("Phí nội thành 20.000đ; miễn phí từ 500.000đ.");
    expect(orderSummary(quote, null)).toContain("Phí giao hàng chưa được shop công bố");
    expect(orderCreatedText()).toContain("COD");
    expect(orderCreatedText()).toContain("chuyển khoản");
  });

  it("offers only in-stock alternatives when a variant ran out", () => {
    const text = orderOutOfStockText([VARIANT], { items, quote }, [{
      productId: PRODUCT, name: "Váy suông linen", price: 350000,
      variants: [
        { variantId: VARIANT, size: "M", color: "be", stock: 0 },
        { variantId: OTHER, size: "L", color: "be", stock: 3 },
      ],
    }]);
    expect(text).toContain("chưa tạo đơn");
    expect(text).toContain("size L màu be");
    expect(text).not.toContain("Shop còn Váy suông linen size M màu be");
    expect(orderOutOfStockText([VARIANT], { items, quote }, [])).toContain("mẫu khác còn hàng");
  });
});
