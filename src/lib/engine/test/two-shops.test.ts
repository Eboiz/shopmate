import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { assertLocalDb, FX } from "./two-shops";

describe("two-shop fixture", () => {
  const all = [...Object.values(FX.a), ...Object.values(FX.b)];

  it("uses strict RFC 4122 uuids", () => {
    for (const id of all) expect(z.uuid().safeParse(id).success, id).toBe(true);
  });

  it("has no duplicate ids, and no id shared between the shops", () => {
    expect(new Set(all).size).toBe(all.length);
    const b = new Set<string>(Object.values(FX.b));
    for (const id of Object.values(FX.a)) expect(b.has(id)).toBe(false);
  });

  describe("assertLocalDb", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("accepts local Supabase", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      expect(() => assertLocalDb()).not.toThrow();
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
      expect(() => assertLocalDb()).not.toThrow();
    });

    it("refuses anything else", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
      expect(() => assertLocalDb()).toThrow("Integration tests only run against local Supabase");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      expect(() => assertLocalDb()).toThrow();
    });
  });
});
