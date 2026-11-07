import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_LENGTH, chatErrors } from "@/lib/chat/request";

const SHOP = { id: "shop-a", name: "Mây Boutique" };
const PRODUCT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(43);

const history = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
const productInShop = vi.fn<(...args: unknown[]) => Promise<boolean>>();
vi.mock("@/lib/chat/web-chat", async (original) => ({
  ...(await original<typeof import("@/lib/chat/web-chat")>()),
  findShop: async (slug: string) => (slug === "may-boutique" ? SHOP : null),
  loadHistory: (...args: unknown[]) => history(...args),
  productInShop: (...args: unknown[]) => productInShop(...args),
}));

const receive = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock("@/lib/channels/receive", () => ({
  receiveChannelMessage: (...args: unknown[]) => receive(...args),
}));

const takeSlot = vi.fn<(input: { shopId: string; clientHash: string; newShopper: boolean }) => Promise<string>>();
vi.mock("@/lib/guard/web-chat-limit", async (original) => ({
  ...(await original<typeof import("@/lib/guard/web-chat-limit")>()),
  takeWebChatSlot: (input: { shopId: string; clientHash: string; newShopper: boolean }) => takeSlot(input),
}));
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_unit_test";

const { GET, POST } = await import("./route");
const { shopperExternalId } = await import("@/lib/chat/web-chat");
const { WEB_CHAT_LIMIT_ERROR, clientHash } = await import("@/lib/guard/web-chat-limit");

const ctx = (slug = "may-boutique") => ({ params: Promise.resolve({ slug }) });
const get = (cookie?: string, slug?: string) =>
  GET(
    new NextRequest(`https://shop.test/api/shops/${slug ?? "may-boutique"}/chat`, {
      headers: cookie ? { cookie: `shopmate_shopper=${cookie}` } : {},
    }),
    ctx(slug),
  );
const post = (body: unknown, { cookie, slug, ip }: { cookie?: string; slug?: string; ip?: string } = {}) =>
  POST(
    new NextRequest(`https://shop.test/api/shops/${slug ?? "may-boutique"}/chat`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie: `shopmate_shopper=${cookie}` } : {}),
        ...(ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {}),
      },
    }),
    ctx(slug),
  );
const valid = { text: "Váy này còn size M không?", productId: PRODUCT, clientMessageId: "c-1" };

beforeEach(() => {
  history.mockReset().mockResolvedValue([]);
  productInShop.mockReset().mockResolvedValue(true);
  receive.mockReset().mockResolvedValue("answered");
  takeSlot.mockReset().mockResolvedValue("ok");
});

describe("POST /api/shops/[slug]/chat limits the client cannot reset", () => {
  it("asks for a slot per client IP and shop before anything is stored, flagging cookie-less requests", async () => {
    await post(valid, { ip: "203.0.113.7" });
    expect(takeSlot).toHaveBeenCalledWith({ shopId: "shop-a", clientHash: clientHash("203.0.113.7"), newShopper: true });
    expect(takeSlot.mock.invocationCallOrder[0]).toBeLessThan(receive.mock.invocationCallOrder[0]);

    await post(valid, { ip: "203.0.113.7", cookie: TOKEN });
    expect(takeSlot.mock.calls[1][0]).toMatchObject({ newShopper: false });
  });

  it("never stores the raw IP", async () => {
    await post(valid, { ip: "203.0.113.7" });
    expect(takeSlot.mock.calls[0][0].clientHash).not.toContain("203.0.113.7");
  });

  it.each(["client", "new_shopper", "shop"] as const)(
    "answers 429 with a Vietnamese error over the %s limit, without a shopper, cookie or AI turn",
    async (limit) => {
      takeSlot.mockResolvedValue(limit);
      const response = await post(valid, { ip: "203.0.113.7" });
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: WEB_CHAT_LIMIT_ERROR[limit] });
      expect(response.cookies.get("shopmate_shopper")).toBeUndefined();
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it("refuses the message when the limit can't be checked (no unchecked AI calls)", async () => {
    takeSlot.mockRejectedValue(new Error("db down"));
    const response = await post(valid);
    expect(response.status).toBe(500);
    expect(receive).not.toHaveBeenCalled();
  });

  it("does not count invalid requests", async () => {
    await post({ ...valid, text: "" });
    expect(takeSlot).not.toHaveBeenCalled();
  });
});

describe("GET /api/shops/[slug]/chat", () => {
  it("returns an empty conversation to a visitor without a cookie, without reading the database", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [] });
    expect(history).not.toHaveBeenCalled();
  });

  it("reads the conversation of the hashed cookie id in the slug's shop", async () => {
    const messages = [{ id: "m", sender: "ai", text: "Dạ", reply: null, createdAt: "2026-11-07T00:00:00Z" }];
    history.mockResolvedValue(messages);
    const response = await get(TOKEN);
    expect(await response.json()).toEqual({ messages });
    expect(history).toHaveBeenCalledWith("shop-a", shopperExternalId(TOKEN));
    expect(shopperExternalId(TOKEN)).not.toBe(TOKEN);
  });

  it("ignores a cookie that we did not issue", async () => {
    await get("short");
    expect(history).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown or malformed shop", async () => {
    expect((await get(undefined, "khong-co")).status).toBe(404);
    expect((await get(undefined, "Bad_Slug")).status).toBe(404);
  });

  it("returns a Vietnamese error when the read fails", async () => {
    history.mockRejectedValue(new Error("db down"));
    const response = await get(TOKEN);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: chatErrors.historyFailed });
  });
});

describe("POST /api/shops/[slug]/chat", () => {
  it("gives a new visitor an httpOnly cookie and passes the hashed id, product and message id to the channel core", async () => {
    const response = await post(valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "answered" });

    const cookie = response.cookies.get("shopmate_shopper");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/api/shops" });
    expect(receive).toHaveBeenCalledWith(
      { channel: "web", shopId: "shop-a" },
      { externalId: shopperExternalId(cookie!.value), messageId: "c-1", text: valid.text, productId: PRODUCT },
    );
    expect(productInShop).toHaveBeenCalledWith("shop-a", PRODUCT);
  });

  it("keeps the existing cookie", async () => {
    const response = await post({ text: "Chào shop", clientMessageId: "c-2" }, { cookie: TOKEN });
    expect(response.cookies.get("shopmate_shopper")).toBeUndefined();
    expect(receive.mock.calls[0][1]).toMatchObject({ externalId: shopperExternalId(TOKEN), productId: null });
    expect(productInShop).not.toHaveBeenCalled();
  });

  it("takes the shop from the slug, never from the body", async () => {
    await post({ ...valid, shopId: "shop-b", shop_id: "shop-b" });
    expect(receive.mock.calls[0][0]).toEqual({ channel: "web", shopId: "shop-a" });
  });

  it.each([
    ["not JSON", "{", chatErrors.invalidBody],
    ["empty text", { ...valid, text: "   " }, "Vui lòng nhập tin nhắn."],
    ["too long", { ...valid, text: "a".repeat(MAX_MESSAGE_LENGTH + 1) }, `Tin nhắn tối đa ${MAX_MESSAGE_LENGTH} ký tự.`],
    ["no message id", { text: "Chào" }, chatErrors.invalidBody],
    ["bad product id", { ...valid, productId: "123" }, chatErrors.invalidBody],
  ])("rejects %s with a Vietnamese error", async (_name, body, error) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(receive).not.toHaveBeenCalled();
  });

  it("rejects a product from another shop", async () => {
    productInShop.mockResolvedValue(false);
    const response = await post(valid);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: chatErrors.productNotFound });
    expect(receive).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown shop", async () => {
    const response = await post(valid, { slug: "khong-co" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: chatErrors.shopNotFound });
  });

  it("still sets the cookie when the turn fails, so the stored message is not orphaned", async () => {
    receive.mockRejectedValue(new Error("db down"));
    const response = await post(valid);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: chatErrors.sendFailed });
    expect(response.cookies.get("shopmate_shopper")?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
