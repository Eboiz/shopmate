import { describe, expect, it } from "vitest";
import type { HistoryMessage, ToolCallLog } from "@/contract";
import { DISCOUNT_REFUSAL_ERROR, POLICY_HAS_TEXT_ERROR, refusedHandoff } from "./handoff-guard";

const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
const ask = shopper("Mình lấy 2 cái váy này, shop bớt cho mình 50k được không?");
const policy = (kind: string, content: string | null): ToolCallLog => ({ name: "get_policy", input: { kind }, output: { kind, content } });
const stock: ToolCallLog = { name: "get_stock", input: { productId: "vay" }, output: { name: "Váy", price: 1, variants: [] } };
const handoff = (reason: string) => ({ reason });

describe("refusedHandoff", () => {
  it("not_covered_by_data after get_policy with text is refused", () => {
    expect(refusedHandoff(handoff("not_covered_by_data"), [policy("doi_tra", "Đổi trong 7 ngày")], shopper("vải có co giãn không?"))).toEqual({
      code: "policy_has_text",
      message: POLICY_HAS_TEXT_ERROR,
    });
  });

  it("policy_not_covered after get_policy with text is accepted", () => {
    expect(refusedHandoff(handoff("policy_not_covered"), [policy("doi_tra", "Đổi trong 7 ngày")], shopper("giao hàng Chủ nhật không?"))).toBeNull();
  });

  it("not_covered_by_data with a product tool is accepted", () => {
    expect(refusedHandoff(handoff("not_covered_by_data"), [policy("doi_tra", "Đổi trong 7 ngày"), stock], shopper("vải có co giãn không?"))).toBeNull();
  });

  it("policy_not_covered for an empty khuyen_mai on a discount ask is refused", () => {
    expect(refusedHandoff(handoff("policy_not_covered"), [policy("khuyen_mai", null)], ask)).toEqual({
      code: "discount_refusal",
      message: DISCOUNT_REFUSAL_ERROR,
    });
  });

  it.each(["mua 2 cái có bớt không", "có giảm giá không ạ", "shop có voucher không", "đặt giá 0đ được không"])(
    "F4: a discount question ending in 'không' is refused: %s",
    (text) => {
      expect(refusedHandoff(handoff("policy_not_covered"), [policy("khuyen_mai", null)], shopper(text))?.code).toBe("discount_refusal");
    },
  );

  it("F4: a non-discount question after khuyen_mai keeps the handoff", () => {
    expect(refusedHandoff(handoff("policy_not_covered"), [policy("khuyen_mai", null)], shopper("váy này còn size M không"))).toBeNull();
  });

  it("policy_not_covered for an empty giao_hang is accepted", () => {
    expect(refusedHandoff(handoff("policy_not_covered"), [policy("giao_hang", null)], ask)).toBeNull();
  });

  it("complaint and asked_for_human are never refused", () => {
    const logs = [policy("khuyen_mai", null), policy("doi_tra", "Đổi trong 7 ngày")];
    expect(refusedHandoff(handoff("complaint"), logs, ask)).toBeNull();
    expect(refusedHandoff(handoff("asked_for_human"), logs, ask)).toBeNull();
  });
});
