import { describe, expect, it } from "vitest";
import type { ToolCallLog } from "@/contract";
import { dataReplyText, falseMissingClaims, missingRetryNote, productIdsInLogs } from "./missing-claim";

const AO = "a0000000-0000-4000-8000-000000000012";
const VAY = "a0000000-0000-4000-8000-000000000011";
const VARIANT = "a0000000-0000-4000-8000-000000000021";

const stockLog: ToolCallLog = {
  name: "get_stock",
  input: { productId: AO },
  output: {
    productId: AO,
    name: "Áo sơ mi trắng công sở",
    price: 289000,
    variants: [
      { variantId: VARIANT, size: "M", color: "trắng", stock: 4 },
      { variantId: VARIANT, size: "M", color: "xanh nhạt", stock: 2 },
      { variantId: VARIANT, size: "L", color: "trắng", stock: 0 },
    ],
  },
};
const sizeLog: ToolCallLog = {
  name: "recommend_size",
  input: { productId: AO, heightCm: 160, weightKg: 50 },
  output: { status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" },
};
const shippingLog: ToolCallLog = {
  name: "get_policy",
  input: { kind: "giao_hang" },
  output: { kind: "giao_hang", content: "Phí ship đồng giá 30.000đ cho mọi đơn. Giao toàn quốc trong 2–4 ngày." },
};
const blankShipping: ToolCallLog = { name: "get_policy", input: { kind: "giao_hang" }, output: { kind: "giao_hang", content: null } };
const returnsLog: ToolCallLog = { name: "get_policy", input: { kind: "doi_tra" }, output: { kind: "doi_tra", content: "Đổi trong 7 ngày" } };

// BOT-01 (test report 12/11): the reply that went out next to a 289.000đ card.
const BOT01 =
  "Dạ, với chiều cao 160cm và cân nặng 50kg thì bạn mặc size M là vừa ạ. Còn giá và màu còn hàng thì mình chưa có thông tin cụ thể, để mình kiểm tra và cập nhật cho bạn nhé.";
// BOT-05: after a handback, "phí ship bao nhiêu?".
const BOT05 = "Dạ, hiện shop chưa có thông tin về phí giao hàng ạ. Về đổi trả, shop hỗ trợ đổi trong 7 ngày.";

describe("falseMissingClaims (PB-39)", () => {
  it("BOT-01: says it has no price / colors in stock while get_stock returned them, and promises an update", () => {
    expect(falseMissingClaims(BOT01, [sizeLog, stockLog], { customer: true }).sort()).toEqual(["price", "promise", "stock"]);
  });

  it("BOT-01 without get_stock this turn: only the promise is wrong (no data to contradict)", () => {
    expect(falseMissingClaims(BOT01, [sizeLog], { customer: true })).toEqual(["promise"]);
  });

  it("the promise is not checked for staff drafts (staff can check)", () => {
    expect(falseMissingClaims(BOT01, [sizeLog], { customer: false })).toEqual([]);
  });

  it("BOT-05: says it has no shipping fee while get_policy(giao_hang) returned the text", () => {
    expect(falseMissingClaims(BOT05, [shippingLog], { customer: true })).toEqual(["giao_hang"]);
  });

  it("no claim when the shop really has no such policy", () => {
    expect(falseMissingClaims(BOT05, [blankShipping, returnsLog], { customer: true })).toEqual([]);
  });

  it("an offer reply may say a policy doesn't cover the question (PB-31), but not that the price is missing", () => {
    const partial = "Dạ, chính sách giao hàng của shop chưa có thông tin về giao Chủ nhật ạ. Bạn có muốn mình nhờ nhân viên shop trả lời thêm không?";
    expect(falseMissingClaims(partial, [shippingLog], { customer: true, offer: true })).toEqual([]);
    const price = "Dạ, mình chưa có giá của áo này. Bạn có muốn mình nhờ nhân viên shop trả lời thêm không?";
    expect(falseMissingClaims(price, [stockLog], { customer: true, offer: true })).toEqual(["price"]);
  });

  it("plain answers from the data pass", () => {
    const ok = "Dạ, áo giá 289.000đ, size M còn màu trắng và xanh nhạt ạ. Màu đỏ thì shop chưa có ạ.";
    expect(falseMissingClaims(ok, [sizeLog, stockLog], { customer: true })).toEqual([]);
    expect(falseMissingClaims("Dạ, phí ship đồng giá 30.000đ cho mọi đơn ạ.", [shippingLog], { customer: true })).toEqual([]);
  });

  it("works on text without diacritics and other wordings", () => {
    expect(falseMissingClaims("Gia ao nay minh chua nam duoc a", [stockLog], { customer: true })).toEqual(["price"]);
    expect(falseMissingClaims("Dạ mình không có thông tin phí ship ạ", [shippingLog], { customer: true })).toEqual(["giao_hang"]);
    expect(falseMissingClaims("Dạ để mình check lại rồi báo bạn sau nhé", [], { customer: true })).toEqual(["promise"]);
  });
});

describe("missingRetryNote", () => {
  it("names what the data has and forbids promising an update", () => {
    const note = missingRetryNote(["price", "stock", "giao_hang", "promise"]);
    expect(note).toContain("giá");
    expect(note).toContain("còn hàng");
    expect(note).toContain("giao hàng");
    expect(note).toContain("cập nhật");
  });
});

describe("dataReplyText: the fallback written from this turn's tool results", () => {
  it("BOT-01: size, price and colors in stock", () => {
    const advice = { status: "ok" as const, size: "M", sizeByHeight: "M", sizeByWeight: "M" };
    const text = dataReplyText([sizeLog, stockLog], advice)!;
    expect(text).toContain("size M");
    expect(text).toContain("289.000đ");
    expect(text).toContain("trắng");
    expect(text).toContain("xanh nhạt");
    expect(text).not.toMatch(/size L màu trắng/);
    expect(text.length).toBeLessThanOrEqual(1000);
  });

  it("BOT-05: the shipping policy as the shop wrote it", () => {
    expect(dataReplyText([returnsLog, shippingLog], null)).toContain("30.000đ");
  });

  it("only the policy kinds the reply got wrong, when given", () => {
    const text = dataReplyText([returnsLog, shippingLog], null, ["giao_hang"])!;
    expect(text).toContain("30.000đ");
    expect(text).not.toContain("7 ngày");
  });

  it("search_products prices when there was no get_stock", () => {
    const search: ToolCallLog = {
      name: "search_products",
      input: { query: "váy" },
      output: { match: "exact", products: [{ productId: VAY, name: "Váy suông linen", category: null, price: 350000, imageUrl: null, description: null, colors: [], sizes: [] }] },
    };
    expect(dataReplyText([search], null)).toContain("350.000đ");
    expect(productIdsInLogs([search])).toEqual([VAY]);
  });

  it("null when the turn looked nothing up", () => {
    expect(dataReplyText([], null)).toBeNull();
    expect(dataReplyText([blankShipping], null)).toBeNull();
  });

  it("product ids for the cards come from get_stock first", () => {
    expect(productIdsInLogs([sizeLog, stockLog])).toEqual([AO]);
  });
});
