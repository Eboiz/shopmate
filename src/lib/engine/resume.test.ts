import { describe, expect, it } from "vitest";
import type { ToolCallLog } from "@/contract";
import { answeredFromData } from "./resume";

const P = "a0000000-0000-4000-8000-000000000011";
const log = (name: ToolCallLog["name"], output: unknown): ToolCallLog => ({ name, input: {}, output });

describe("answeredFromData (PB-14 AC2, D2)", () => {
  it.each<[string, ToolCallLog]>([
    ["get_stock", log("get_stock", { productId: P, name: "Váy", price: 1, variants: [] })],
    ["recommend_size ok", log("recommend_size", { status: "ok", size: "M", sizeByHeight: "M", sizeByWeight: "M" })],
    ["get_pairings", log("get_pairings", { pairings: [] })],
    ["quote_order", log("quote_order", { lines: [], total: 0 })],
    ["get_policy with text", log("get_policy", { kind: "doi_tra", content: "Đổi trong 7 ngày" })],
    ["search_products with a product", log("search_products", { products: [{ productId: P }] })],
  ])("%s → true", (_name, entry) => {
    expect(answeredFromData([entry])).toBe(true);
  });

  it.each<[string, ToolCallLog[]]>([
    ["no tools", []],
    ["empty search", [log("search_products", { products: [] })]],
    ["get_policy null", [log("get_policy", { kind: "khuyen_mai", content: null })]],
    ["recommend_size out_of_range", [log("recommend_size", { status: "out_of_range" })]],
    ["a failed get_stock", [{ name: "get_stock", input: {}, error: "product_not_found" }]],
    ["handoff_to_staff", [log("handoff_to_staff", { mode: "needs_human" })]],
    ["create_draft_order", [log("create_draft_order", { status: "created", orderId: P, total: 1 })]],
  ])("%s → false", (_name, logs) => {
    expect(answeredFromData(logs)).toBe(false);
  });
});
