import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.SUPABASE_SECRET_KEY ??= "sb_secret_unit_test";

type RpcCall = { fn: string; args: Record<string, unknown> };
let calls: RpcCall[];
let result: { data: string | null; error: { message: string } | null };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(result);
    },
  }),
}));

const { clientHash } = await import("./web-chat-limit");
const { SEARCH_LIMIT, searchClientHash, takeSearchSlot } = await import("./search-limit");

const input = { shopId: "shop-a", clientHash: "hash-a" };

beforeEach(() => {
  calls = [];
  result = { data: "ok", error: null };
});

describe("takeSearchSlot", () => {
  it("passes SEARCH_LIMIT numbers to search_take", async () => {
    expect(await takeSearchSlot(input)).toBe("ok");
    expect(SEARCH_LIMIT).toEqual({ clientShopPerMinute: 20, shopPerMinute: 120 });
    expect(calls).toEqual([
      {
        fn: "search_take",
        args: {
          p_shop_id: "shop-a",
          p_client_hash: "hash-a",
          p_client_shop_per_minute: SEARCH_LIMIT.clientShopPerMinute,
          p_shop_per_minute: SEARCH_LIMIT.shopPerMinute,
        },
      },
    ]);
  });

  it("throws on an rpc error and on an unexpected result", async () => {
    result = { data: null, error: { message: "timeout" } };
    await expect(takeSearchSlot(input)).rejects.toThrow("search_take: timeout");

    result = { data: "maybe", error: null };
    await expect(takeSearchSlot(input)).rejects.toThrow("search_take: unexpected result maybe");
  });
});

describe("searchClientHash", () => {
  it("differs from the web chat hash of the same ip", () => {
    expect(searchClientHash("203.0.113.9")).not.toBe(clientHash("203.0.113.9"));
    expect(searchClientHash("203.0.113.9")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
