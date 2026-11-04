import { describe, expect, it } from "vitest";
import { isNavItemActive } from "./admin-nav";

describe("isNavItemActive", () => {
  it("matches the item's page and the pages under it", () => {
    expect(isNavItemActive("/admin/orders", "/admin/orders")).toBe(true);
    expect(isNavItemActive("/admin/orders/42", "/admin/orders")).toBe(true);
  });

  it("does not match other pages that share a prefix", () => {
    expect(isNavItemActive("/admin/orders-old", "/admin/orders")).toBe(false);
    expect(isNavItemActive("/admin/inbox", "/admin/orders")).toBe(false);
  });
});
