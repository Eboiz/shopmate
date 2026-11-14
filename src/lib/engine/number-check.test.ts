import { describe, expect, it } from "vitest";
import type { ToolCallLog } from "@/contract";
import { findUncheckedNumbers } from "./number-check";

const P = "a0000000-0000-4000-8000-000000000011";
const V = "a0000000-0000-4000-8000-000000000021";

const search = (price: number): ToolCallLog => ({
  name: "search_products",
  input: { query: "váy linen" },
  output: { products: [{ productId: P, name: "Váy suông linen", category: "Váy", price, imageUrl: null, colors: ["Be"], sizes: ["M"] }] },
});
const stock = (price: number, ...stocks: number[]): ToolCallLog => ({
  name: "get_stock",
  input: { productId: P },
  output: { productId: P, name: "Váy suông linen", price, variants: stocks.map((s, i) => ({ variantId: V, size: ["S", "M", "L"][i] ?? "XL", color: "Be", stock: s })) },
});
const policy = (kind: string, content: string | null): ToolCallLog => ({ name: "get_policy", input: { kind }, output: { kind, content } });
const quote: ToolCallLog = {
  name: "quote_order",
  input: { items: [{ variantId: V, quantity: 2 }] },
  output: { lines: [{ variantId: V, productId: P, name: "Váy suông linen", size: "M", color: "Be", quantity: 2, unitPrice: 389000, lineTotal: 778000 }], total: 778000 },
};
const failedStock: ToolCallLog = { name: "get_stock", input: { productId: P }, error: "product_not_found" };

const raws = (reply: string, logs: ToolCallLog[], shopper = "") => findUncheckedNumbers(reply, logs, shopper).map((i) => i.raw);

describe("findUncheckedNumbers (PB-07)", () => {
  it.each([
    ["350k", "Váy giá 350k ạ"],
    ["350.000đ", "Váy giá 350.000đ ạ"],
    ["350.000 đ", "Váy giá 350.000 đ ạ"],
    ["350 nghìn", "Váy giá 350 nghìn ạ"],
    ["350,000đ", "Váy giá 350,000đ."],
    ["350.000 đồng", "Váy giá 350.000 đồng."],
    ["350 ngàn", "Váy 350 ngàn thôi ạ"],
    ["350.000VNĐ", "Giá 350.000VNĐ"],
  ])("price format %s matching a tool price passes", (_format, reply) => {
    expect(raws(reply, [search(350000)])).toEqual([]);
  });

  it.each([
    ["350k", "Váy giá 350k ạ"],
    ["350.000đ", "Váy giá 350.000đ ạ"],
    ["350.000 đ", "Váy giá 350.000 đ ạ"],
    ["350 nghìn", "Váy giá 350 nghìn ạ"],
    ["389.000đ", "Váy giá 389.000đ ạ"],
  ])("price format %s not matching the tool price is flagged", (raw, reply) => {
    expect(raws(reply, [search(399000)])).toEqual([raw]);
  });

  it("389.000đ from get_stock passes", () => {
    expect(raws("Váy suông linen giá 389.000đ, màu be còn 7 cái.", [stock(389000, 7)])).toEqual([]);
  });

  it("an order summary with line totals and the total passes", () => {
    expect(raws("2 × Váy suông linen 389.000đ = 778.000đ. Tổng 778.000đ.", [quote])).toEqual([]);
  });

  it("a total no tool computed is flagged", () => {
    expect(raws("Tổng cộng 179.000đ bạn nhé", [stock(149000, 12), policy("giao_hang", "Tỉnh khác phí 30.000đ.")])).toEqual(["179.000đ"]);
  });

  it("a shipping fee from get_policy text passes", () => {
    expect(raws("Ship tỉnh phí 30.000đ, đơn từ 500k được miễn phí.", [policy("giao_hang", "Tỉnh khác 3–5 ngày, phí 30.000đ. Miễn phí giao hàng cho đơn từ 500.000đ.")])).toEqual([]);
  });

  it("còn 7 chiếc and (còn 5) matching get_stock pass", () => {
    expect(raws("Size M còn 7 chiếc, size L (còn 5).", [stock(389000, 7, 5)])).toEqual([]);
  });

  it("(5) after a variant matching get_stock passes", () => {
    expect(raws("Màu be: S (7), M (5)", [stock(389000, 7, 5)])).toEqual([]);
  });

  it.each([
    "Váy còn 2 màu là be và trắng ạ",
    "Mẫu này còn 3 size S, M, L ạ",
    "Bạn chọn (1) size M hoặc (2) size L nhé",
    "Còn 2 lựa chọn cho bạn ạ",
  ])("a count that is not stock is not checked: %s", (reply) => {
    expect(raws(reply, [stock(389000, 7)])).toEqual([]);
  });

  it("(còn N) and còn N sản phẩm not matching get_stock are flagged", () => {
    expect(raws("Size M (còn 4), size L còn 9 sản phẩm.", [stock(389000, 7)])).toEqual(["(còn 4)", "còn 9 sản phẩm"]);
  });

  it("a wrong stock number is flagged", () => {
    const issues = findUncheckedNumbers("Size M còn 3 cái ạ", [stock(389000, 2)], "");
    expect(issues).toEqual([{ kind: "stock", raw: "còn 3 cái", value: 3 }]);
  });

  it("stock from search_products is not a stock source (it has none)", () => {
    expect(raws("Còn 2 cái ạ", [search(389000)])).toEqual(["Còn 2 cái"]);
  });

  it("a failed tool call allows nothing", () => {
    expect(raws("Giá 389.000đ, còn 2 cái", [failedStock])).toEqual(["389.000đ", "còn 2 cái"]);
  });

  it("no tool at all flags every price and stock", () => {
    expect(raws("Váy 389k, còn 2 cái", [])).toEqual(["389k", "còn 2 cái"]);
  });

  it("amounts from the latest shopper message and measurements are not checked", () => {
    const shopper = "Mình cao 1m65 nặng 58kg, lấy 2 cái shop bớt 50k được không?";
    expect(raws("Dạ bạn cao 1m65, nặng 58kg mặc size L. Shop không bớt 50k được ạ, giá vẫn 389.000đ.", [stock(389000, 7)], shopper)).toEqual([]);
  });

  it("58 ký, 160cm and a size name are not prices", () => {
    expect(raws("Bạn 160cm, 58 ký thì mặc size M hoặc size 28 nhé.", [])).toEqual([]);
  });

  it("a quantity of garments is not a price (2 đầm)", () => {
    expect(raws("Bạn lấy 2 đầm nhé", [])).toEqual([]);
  });

  it("a reply with no numbers has no issues", () => {
    expect(findUncheckedNumbers("Dạ chào bạn, bạn đang tìm món gì ạ?", [], "")).toEqual([]);
  });

  it("days in a policy answer are not checked", () => {
    expect(raws("Đổi trong 7 ngày, giao 3–5 ngày.", [policy("doi_tra", "Đổi trong 7 ngày")])).toEqual([]);
  });

  it("a price from get_pairings passes", () => {
    const pairings: ToolCallLog = {
      name: "get_pairings",
      input: { productId: P },
      output: { pairings: [{ productId: P, name: "Váy suông linen", price: 389000, imageUrl: null, reason: "x", sizesInStock: ["M"] }] },
    };
    expect(raws("Phối với Váy suông linen 389k nhé", [pairings])).toEqual([]);
  });

  it("the order total from create_draft_order passes", () => {
    const created: ToolCallLog = { name: "create_draft_order", input: {}, output: { status: "created", orderId: P, total: 798000 } };
    expect(raws("Đơn của bạn tổng 798.000đ", [created])).toEqual([]);
  });
});
