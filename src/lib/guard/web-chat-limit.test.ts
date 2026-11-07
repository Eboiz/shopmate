import { describe, expect, it } from "vitest";

process.env.SUPABASE_SECRET_KEY ??= "sb_secret_unit_test";
const { clientHash, clientIp } = await import("./web-chat-limit");

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.9" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("puts requests without either header in one bucket", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("clientHash", () => {
  it("is stable, differs per IP, and does not contain the IP", () => {
    expect(clientHash("203.0.113.9")).toBe(clientHash("203.0.113.9"));
    expect(clientHash("203.0.113.9")).not.toBe(clientHash("203.0.113.10"));
    expect(clientHash("203.0.113.9")).not.toContain("203.0.113.9");
    expect(clientHash("203.0.113.9")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
