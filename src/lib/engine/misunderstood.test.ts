import { describe, expect, it } from "vitest";
import type { ToolCallLog } from "@/contract";
import { answersAiMessage, productMissed, searchMissed, shopperTurnText } from "./misunderstood";

const P = "a0000000-0000-4000-8000-000000000011";
const search = (products: unknown[]): ToolCallLog => ({ name: "search_products", input: { query: "x" }, output: { products } });
const failedSearch: ToolCallLog = { name: "search_products", input: { query: "x" }, error: "internal_error: db" };
// A search log with the model's own query wording.
const querySearch = (query: string, products: unknown[]): ToolCallLog =>
  ({ name: "search_products", input: { query }, output: { products } });
const stockOn = (productId: string): ToolCallLog => ({ name: "get_stock", input: { productId }, output: {} });

describe("searchMissed", () => {
  it("is true when every search came back empty and no product tool ran", () => {
    expect(searchMissed([search([])])).toBe(true);
    expect(searchMissed([search([]), search([])])).toBe(true);
    expect(searchMissed([search([]), { name: "get_policy", input: {}, output: {} }])).toBe(true);
    // A product tool that failed (e.g. a made-up id) doesn't mean the product was found.
    expect(searchMissed([search([]), { name: "get_stock", input: { productId: P }, error: "product_not_found" }])).toBe(true);
  });

  it("is false without a search, when a search found something, or failed", () => {
    expect(searchMissed([])).toBe(false);
    expect(searchMissed([{ name: "get_policy", input: {}, output: {} }])).toBe(false);
    expect(searchMissed([search([]), search([{ productId: P }])])).toBe(false);
    expect(searchMissed([failedSearch])).toBe(false);
    expect(searchMissed([search([]), failedSearch])).toBe(false);
  });

  it("is false when the turn worked on a known product", () => {
    expect(searchMissed([search([]), { name: "get_stock", input: { productId: P }, output: {} }])).toBe(false);
    expect(searchMissed([search([]), { name: "recommend_size", input: { productId: P }, output: {} }])).toBe(false);
  });
});

describe("productMissed (the shopper's own search decides, PB-05 AC3)", () => {
  // Valid 12-char hex tails ("01".."05"), so get_stock really runs ok on one.
  const jackets = [1, 2, 3, 4, 5].map((n) => `a0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`);
  const followUp = "loại áo khoác da màu đen ấy";

  it("broadened search does not hide the miss", () => {
    const logs = [
      querySearch("áo khoác", jackets.map((productId) => ({ productId }))),
      querySearch("áo khoác da", []),
      stockOn(jackets[0]),
    ];
    expect(productMissed(logs, followUp, null)).toBe(true);
  });

  it("a shopper-worded search with results is not a miss even if another search is empty", () => {
    const logs = [querySearch("váy suông linen be", []), querySearch("váy suông linen", [{ productId: P }])];
    expect(productMissed(logs, "váy suông linen màu be", null)).toBe(false);
  });

  it("product tool on the viewed product is not a miss", () => {
    // "da" is not the shopper's wording, so the fallback (all searches) applies.
    const logs = [querySearch("da", []), stockOn(P)];
    expect(productMissed(logs, "cái mình đang xem đó", P)).toBe(false);
  });

  it("no search is not a miss", () => {
    expect(productMissed([], followUp, null)).toBe(false);
    expect(productMissed([{ name: "get_policy", input: {}, output: {} }], followUp, null)).toBe(false);
  });

  it("a failed search is not a miss", () => {
    expect(productMissed([failedSearch], followUp, null)).toBe(false);
  });
});

describe("shopperTurnText", () => {
  it("joins the shopper messages after the last AI message", () => {
    expect(shopperTurnText([
      { sender: "shopper", text: "áo khoác da" },
      { sender: "ai", text: "bạn tìm loại nào?" },
      { sender: "shopper", text: "loại da" },
      { sender: "shopper", text: "màu đen" },
    ])).toBe("loại da\nmàu đen");
  });

  it("skips system notices and staff replies between the AI and the shopper", () => {
    expect(shopperTurnText([
      { sender: "ai", text: "?" },
      { sender: "system", text: "notice" },
      { sender: "staff", text: "chờ chút" },
      { sender: "shopper", text: "áo da" },
    ])).toBe("áo da");
  });
});

describe("answersAiMessage", () => {
  it("is true when the shopper writes right after the AI", () => {
    expect(answersAiMessage([{ sender: "shopper", text: "a" }, { sender: "ai", text: "?" }, { sender: "shopper", text: "b" }])).toBe(true);
    expect(answersAiMessage([
      { sender: "ai", text: "?" },
      { sender: "system", text: "notice" },
      { sender: "shopper", text: "b" },
      { sender: "shopper", text: "c" },
    ])).toBe(true);
  });

  it("is false for a first message or after a staff reply", () => {
    expect(answersAiMessage([{ sender: "shopper", text: "a" }])).toBe(false);
    expect(answersAiMessage([{ sender: "ai", text: "?" }, { sender: "staff", text: "hi" }, { sender: "shopper", text: "b" }])).toBe(false);
  });
});
