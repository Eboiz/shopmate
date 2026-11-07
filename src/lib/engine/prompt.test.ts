import { describe, expect, it } from "vitest";
import { buildStablePrompt, buildSystemPrompt, buildVolatilePrompt, PROMPT_VERSION } from "./prompt";

const SHOP_A = "a0000000-0000-4000-8000-000000000001";
const productA = { id: "a0000000-0000-4000-8000-000000000011", name: "Váy suông linen" };
const productB = { id: "b0000000-0000-4000-8000-000000000011", name: "Áo khoác jean" };
const NO_ORDERS = "không tạo đơn";

describe("prompt", () => {
  it("states the version and the reply limits", () => {
    const p = buildStablePrompt("customer");
    expect(p).toContain(PROMPT_VERSION);
    for (const n of ["1000", "10", "20"]) expect(p).toContain(n);
    expect(p).not.toContain(SHOP_A);
  });

  it("forbids orders and handoff only in staff_draft", () => {
    expect(buildStablePrompt("staff_draft")).toContain(NO_ORDERS);
    expect(buildStablePrompt("customer")).not.toContain(NO_ORDERS);
    expect(buildStablePrompt("staff_draft")).not.toBe(buildStablePrompt("customer"));
  });

  it("customer prompt has the four handoff and no-promise rules; staff_draft has no handoff", () => {
    const customer = buildStablePrompt("customer");
    expect(PROMPT_VERSION).toBe("v0.6");
    for (const needle of ["Không hứa hẹn", "policy_not_covered", "no_chart", "asked_for_human"]) expect(customer).toContain(needle);
    expect(buildStablePrompt("staff_draft")).not.toContain("handoff_to_staff");
  });

  it("asks for declared pairings with the shopper's size and at most two suggestions", () => {
    const prompt = buildStablePrompt("customer");
    for (const phrase of ["get_pairings", "size khách đã nói", "tối đa 2 món", "lý do shop đã khai báo"]) {
      expect(prompt).toContain(phrase);
    }
  });

  it("has the PB-05 stock and not-found rules and the PB-06 size rules (v0.3)", () => {
    const customer = buildStablePrompt("customer");
    for (const phrase of [
      "hỏi lại khách MỘT câu", // one clarifying question for an unknown product
      "gợi ý những size, màu khác", // out of stock -> in-stock alternatives
      "báo giá lấy từ tool",
      "1m65 → 165", // measurement conversion
      "58 cân → 58",
      "sizeByHeight khác sizeByWeight", // say why the larger size
      "thiếu số nào thì hỏi đúng số đó",
      "phải nêu đúng `size` của recommend_size", // PB-06 size post-check
    ]) {
      expect(customer).toContain(phrase);
    }
    const staff = buildStablePrompt("staff_draft");
    expect(staff).toContain("1m65 → 165");
    expect(staff).not.toContain("hỏi lại khách MỘT câu");
  });

  it("keeps search_products queries to the product name (PB-05 AC4)", () => {
    for (const mode of ["customer", "staff_draft"] as const) {
      expect(buildStablePrompt(mode)).toContain("query của search_products chỉ gồm tên hoặc loại sản phẩm");
    }
  });

  it("stable prompt does not depend on the product", () => {
    const blocks = [productA, productB, null].map((product) => buildSystemPrompt({ mode: "customer", product }));
    for (const b of blocks) {
      expect(b[0].text).toBe(blocks[0][0].text);
      expect(b[0].cache_control?.type).toBe("ephemeral");
    }
    expect(buildSystemPrompt({ mode: "customer", product: productA })).toEqual(
      buildSystemPrompt({ mode: "customer", product: productA }),
    );
  });

  it("volatile prompt holds the product", () => {
    expect(buildSystemPrompt({ mode: "customer", product: null })).toHaveLength(1);
    expect(buildVolatilePrompt(null)).toBeNull();
    const blocks = buildSystemPrompt({ mode: "customer", product: productA });
    expect(blocks).toHaveLength(2);
    expect(blocks[1].text).toContain(productA.name);
    expect(blocks[1].text).toContain(productA.id);
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[0].text).not.toContain(productA.name);
    expect(blocks[0].text).not.toContain(productA.id);
  });
});
