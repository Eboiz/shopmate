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
    // Spread over two shops so the per-shop and per-minute caps don't stop it first.
    for (let i = 0; i < WEB_CHAT_LIMIT.newShoppersPerHour + 3; i++) {
      const shopId = i % 2 === 0 ? FX.a.shop : FX.b.shop;
      results.push(await takeWebChatSlot({ shopId, clientHash: flood, newShopper: true }));
    }
    expect(results.filter((r) => r === "ok")).toHaveLength(WEB_CHAT_LIMIT.newShoppersPerHour);
    expect(results.slice(WEB_CHAT_LIMIT.newShoppersPerHour)).toEqual(["new_shopper", "new_shopper", "new_shopper"]);

    // Another visitor, and a returning shopper (with cookie) behind another IP, are unaffected.
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: client(), newShopper: true })).toBe("ok");
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: client(), newShopper: false })).toBe("ok");
  });

  it("lets a normal shopper keep chatting, up to the per-IP-per-shop and per-IP limits", async () => {
    const shopper = client();
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: shopper, newShopper: true })).toBe("ok");
    for (let i = 1; i < WEB_CHAT_LIMIT.clientShopPerMinute; i++) {
      expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: shopper, newShopper: false })).toBe("ok");
    }
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: shopper, newShopper: false })).toBe("client_shop");

    // The same IP can still write to another shop, until its total per minute.
    const left = WEB_CHAT_LIMIT.clientPerMinute - WEB_CHAT_LIMIT.clientShopPerMinute;
    for (let i = 0; i < left; i++) {
      expect(await takeWebChatSlot({ shopId: FX.b.shop, clientHash: shopper, newShopper: false })).toBe("ok");
    }
    expect(await takeWebChatSlot({ shopId: FX.b.shop, clientHash: shopper, newShopper: false })).toBe("client");
  });

  it("two busy IPs can't use up a shop's chat for everyone", async () => {
    for (const ip of [client(), client()]) {
      for (let i = 0; i < WEB_CHAT_LIMIT.clientShopPerMinute; i++) {
        expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: ip, newShopper: false })).toBe("ok");
      }
      expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: ip, newShopper: false })).toBe("client_shop");
    }
    expect(2 * WEB_CHAT_LIMIT.clientShopPerMinute).toBeLessThan(WEB_CHAT_LIMIT.shopPerMinute);
    expect(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: client(), newShopper: true })).toBe("ok");
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
    const results = [];
    for (let i = 0; i < WEB_CHAT_LIMIT.clientShopPerMinute + 3; i++) {
      results.push(await takeWebChatSlot({ shopId: FX.a.shop, clientHash: flood, newShopper: true }));
    }
    expect(results.filter((r) => r !== "ok")).toEqual(["client_shop", "client_shop", "client_shop"]);
    const { count } = await db
      .from("web_chat_hits")
      .select("id", { count: "exact", head: true })
      .eq("client_hash", flood);
    expect(count).toBe(WEB_CHAT_LIMIT.clientShopPerMinute);
  });

  it("is not callable by the API roles", async () => {
    const anon = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/web_chat_take`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        p_shop_id: FX.a.shop, p_client_hash: client(), p_new_shopper: true,
        p_client_per_minute: 1000, p_new_shoppers_per_hour: 1000, p_shop_per_minute: 1000, p_client_shop_per_minute: 1000,
      }),
    });
    expect(anon.ok).toBe(false);
    const read = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/web_chat_hits?select=id`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    });
    expect(read.ok).toBe(false);
  });
});
