import { describe, expect, it } from "vitest";
import { isProtectedPath, loginRedirectUrl, safeNextPath } from "./auth-routes";

describe("isProtectedPath", () => {
  it.each([
    ["/admin", true],
    ["/admin/orders", true],
    ["/administrator", false],
    ["/login", false],
    ["/s/demo-shop", false],
    ["/", false],
  ])("%s -> %s", (path, expected) => {
    expect(isProtectedPath(path)).toBe(expected);
  });
});

describe("safeNextPath", () => {
  it("keeps admin paths", () => {
    expect(safeNextPath("/admin/orders?x=1")).toBe("/admin/orders?x=1");
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.com",
    "//evil.com",
    "/s/demo",
    "/administrator",
  ])("falls back to /admin for %s", (next) => {
    expect(safeNextPath(next)).toBe("/admin");
  });
});

describe("loginRedirectUrl", () => {
  it("encodes the original path as next", () => {
    expect(loginRedirectUrl("/admin/orders", "?id=3")).toBe(
      "/login?next=%2Fadmin%2Forders%3Fid%3D3",
    );
  });
});
