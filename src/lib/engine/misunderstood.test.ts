import { describe, expect, it } from "vitest";
import type { ToolCallLog } from "@/contract";
import { answersAiMessage, searchMissed } from "./misunderstood";

const P = "a0000000-0000-4000-8000-000000000011";
const search = (products: unknown[]): ToolCallLog => ({ name: "search_products", input: { query: "x" }, output: { products } });
const failedSearch: ToolCallLog = { name: "search_products", input: { query: "x" }, error: "internal_error: db" };

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
