import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FX, cleanupTwoShops, seedTwoShops } from "@/lib/engine/test/two-shops";
import { createAdminClient } from "@/lib/supabase/admin";
import { WEB_CHAT_LIMIT, clientHash, takeWebChatSlot } from "./web-chat-limit";

// PB-04: the web chat limits on local Supabase (web_chat_take).

const db = createAdminClient();
const client = () => clientHash(`ip-${randomUUID()}`);

beforeAll(() => seedTwoShops(db));
afterAll(() => cleanupTwoShops(db));
// Each test starts with empty windows for the fixture shops.
beforeEach(async () => {
  const { error } = await db.from("web_chat_hits").delete().in("shop_id", [FX.a.shop, FX.b.shop]);
  if (error) throw new Error(error.message);
});

describe("takeWebChatSlot", () => {
  it("blocks a cookie-less flood from one IP after the new-shopper limit", async () => {
    const flood = client();
    const results = [];
    for (let i = 0; i < WEB_CHAT_LIMIT.newShoppersPerHour + 3; i++) {
      results.push(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: flood, newShopper: true }));
    }
    expect(results.filter((r) => r === "ok")).toHaveLength(WEB_CHAT_LIMIT.newShoppersPerHour);
    expect(results.slice(WEB_CHAT_LIMIT.newShoppersPerHour)).toEqual(["new_shopper", "new_shopper", "new_shopper"]);

    // Another visitor, and a returning shopper (with cookie) behind another IP, are unaffected.
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: client(), newShopper: true })).toBe("ok");
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: client(), newShopper: false })).toBe("ok");
  });

  it("lets a normal shopper with a cookie keep chatting, up to the per-IP minute limit", async () => {
    const shopper = client();
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: shopper, newShopper: true })).toBe("ok");
    for (let i = 1; i < WEB_CHAT_LIMIT.clientPerMinute; i++) {
      expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: shopper, newShopper: false })).toBe("ok");
    }
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: shopper, newShopper: false })).toBe("client");
    // The same IP is blocked in every shop: the count is per client.
    expect(await takeWebChatSlot({ shopId: FX.b.shop, clientHash: shopper, newShopper: false })).toBe("client");
  });

  it("caps a shop across many IPs, without touching other shops", async () => {
    const { count } = await db
      .from("web_chat_hits")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", FX.b.shop);
    const rows = Array.from({ length: WEB_CHAT_LIMIT.shopPerMinute - (count ?? 0) }, () => ({
      shop_id: FX.b.shop,
      client_hash: client(),
      new_shopper: false,
    }));
    const insert = await db.from("web_chat_hits").insert(rows);
    if (insert.error) throw new Error(insert.error.message);

    expect(await takeWebChatSlot({ shopId: FX.b.shop, clientHash: client(), newShopper: false })).toBe("shop");
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: client(), newShopper: false })).toBe("ok");
  });

  it("records nothing for a refused request", async () => {
    const flood = client();
    for (let i = 0; i < WEB_CHAT_LIMIT.newShoppersPerHour + 2; i++) {
      await takeWebChatSlot({ shopId: FX.a.shop, clientHash: flood, newShopper: true });
    }
    const { count } = await db
      .from("web_chat_hits")
      .select("id", { count: "exact", head: true })
      .eq("client_hash", flood);
    expect(count).toBe(WEB_CHAT_LIMIT.newShoppersPerHour);
  });

  it("is not callable by the API roles", async () => {
    const anon = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/web_chat_take`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        p_shop_id: FX.a.shop, p_client_hash: client(), p_new_shopper: true,
        p_client_per_minute: 1000, p_new_shoppers_per_hour: 1000, p_shop_per_minute: 1000,
      }),
    });
    expect(anon.ok).toBe(false);
    const read = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/web_chat_hits?select=id`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    });
    expect(read.ok).toBe(false);
  });
});
