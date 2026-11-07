import { describe, expect, it } from "vitest";
import { mergeItems } from "./order-items";

describe("mergeItems", () => {
  it("adds up repeated variants and keeps first-seen order", () => {
    expect(
      mergeItems([
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 2 },
        { variantId: "v1", quantity: 3 },
      ]),
    ).toEqual([
      { variantId: "v1", quantity: 4 },
      { variantId: "v2", quantity: 2 },
    ]);
  });
});
