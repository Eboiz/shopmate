import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineInput, EngineOutput } from "@/contract";
import { receiveChannelMessage } from "@/lib/channels/receive";
import { sendToConversation } from "@/lib/channels/send";
import { FX, cleanupTwoShops, seedTwoShops } from "@/lib/engine/test/two-shops";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatStatus } from "./chat-status";
import { findShop, loadCatalog, loadHistory, productInShop, shopperExternalId } from "./web-chat";

// Web chat (PB-04) end to end on local Supabase, with the model replaced: the
// shopper's message goes through the shared channel core, the AI reply, a staff
// reply (PB-13) and an order update (PB-12) are sent with sendToConversation,
// and the history the shop page polls shows all of them, for this shopper only.

const engine = vi.fn<(input: EngineInput) => Promise<EngineOutput>>();
vi.mock("@/lib/engine/run", () => ({
  runCustomerTurn: async (input: EngineInput) => ({ output: await engine(input), orderWritten: false, turnRow: Promise.resolve(null) }),
}));

const db = createAdminClient();
const web = { channel: "web" as const, shopId: FX.a.shop };
const shopper = shopperExternalId(`token-${randomUUID()}`);
const aiReply = {
  text: "Váy suông linen còn size M ạ.",
  products: [{ productId: FX.a.vay01, name: "Váy suông linen", price: 350000, imageUrl: null, sizesInStock: ["M"] }],
  quickReplies: ["Đặt size M"],
};
let staffId: string;

// Staff messages reference the staff profile, which the shop delete removes in
// the same cascade, so they go first.
const dropStaffMessages = () => db.from("messages").delete().eq("shop_id", FX.a.shop).eq("sender", "staff");

beforeAll(async () => {
  await dropStaffMessages();
  await seedTwoShops(db);
  const { data, error } = await db.auth.admin.createUser({
    email: `pb04-${randomUUID()}@example.test`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error) throw error;
  staffId = data.user.id;
  const profile = await db.from("profiles").insert({ id: staffId, shop_id: FX.a.shop, role: "staff" });
  if (profile.error) throw new Error(profile.error.message);
});

afterAll(async () => {
  await dropStaffMessages();
  await cleanupTwoShops(db);
  if (staffId) await db.auth.admin.deleteUser(staffId);
});

beforeEach(() => {
  engine.mockReset().mockResolvedValue({ reply: aiReply, personalReplyNeeded: false });
});

describe("web chat on local Supabase", () => {
  it("resolves shops by slug and checks products belong to the shop", async () => {
    expect(await findShop("shop-a-pb03")).toEqual({ id: FX.a.shop, name: "Shop A PB-03" });
    expect(await findShop("khong-co-shop")).toBeNull();
    expect(await productInShop(FX.a.shop, FX.a.vay01)).toBe(true);
    expect(await productInShop(FX.a.shop, FX.b.vay01)).toBe(false);
  });

  it("lists only the shop's products with in-stock colors and sizes", async () => {
    const catalog = await loadCatalog({ id: FX.a.shop, name: "Shop A PB-03" });
    expect(catalog.products.map((p) => p.id).toSorted()).toEqual(
      [FX.a.ao03, FX.a.quan05, FX.a.vay01, FX.a.blazer, FX.a.bomber, FX.a.jacketJean, FX.a.jean].toSorted(),
    );
    const vay = catalog.products.find((p) => p.id === FX.a.vay01)!;
    expect(vay).toMatchObject({ price: 350000, colors: ["be", "đen"], sizesInStock: ["M"] });
  });

  it("stores the message, passes the product to the engine, and dedupes a retry", async () => {
    const first = await receiveChannelMessage(web, {
      externalId: shopper,
      messageId: "client-1",
      text: "Váy này còn size M không?",
      productId: FX.a.vay01,
    });
    expect(first).toBe("answered");
    expect(engine).toHaveBeenCalledWith(expect.objectContaining({ mode: "customer", productId: FX.a.vay01 }));

    const retry = await receiveChannelMessage(web, {
      externalId: shopper,
      messageId: "client-1",
      text: "Váy này còn size M không?",
      productId: FX.a.vay01,
    });
    expect(retry).toBe("duplicate");
    expect(engine).toHaveBeenCalledOnce();

    const { messages: history, mode } = await loadHistory(FX.a.shop, shopper);
    expect(mode).toBe("ai");
    expect(history.map((m) => [m.sender, m.text])).toEqual([
      ["shopper", "Váy này còn size M không?"],
      ["ai", aiReply.text],
    ]);
    expect(history[1].reply).toEqual(aiReply);
  });

  it("shows staff replies and order updates sent with sendToConversation", async () => {
    const [{ id: conversationId }] = await db
      .from("conversations")
      .select("id, shoppers!inner(external_id)")
      .eq("shop_id", FX.a.shop)
      .eq("shoppers.external_id", shopper)
      .then(({ data }) => data!);
    await db.from("conversations").update({ mode: "staff" }).eq("id", conversationId);

    const staff = await sendToConversation(conversationId, { text: "Shop gửi bạn mã giảm ship nha.", products: [], quickReplies: [] }, { from: "staff", staffId });
    expect(staff.ok).toBe(true);
    const order = await sendToConversation(conversationId, { text: "Đơn hàng của bạn đã được xác nhận.", products: [], quickReplies: [] }, { from: "system" });
    expect(order.ok).toBe(true);

    // In staff mode the AI stays silent, but the shopper's message is kept.
    expect(await receiveChannelMessage(web, { externalId: shopper, messageId: "client-2", text: "Cảm ơn shop" })).toBe("stored");

    const { messages: history, mode } = await loadHistory(FX.a.shop, shopper);
    expect(mode).toBe("staff");
    expect(history.slice(-3).map((m) => [m.sender, m.text])).toEqual([
      ["staff", "Shop gửi bạn mã giảm ship nha."],
      ["system", "Đơn hàng của bạn đã được xác nhận."],
      ["shopper", "Cảm ơn shop"],
    ]);
  });

  it("never shows one shopper's or shop's chat to another", async () => {
    expect(await loadHistory(FX.a.shop, shopperExternalId("someone-else"))).toEqual({ messages: [], mode: "ai" });
    expect(await loadHistory(FX.b.shop, shopper)).toEqual({ messages: [], mode: "ai" });
  });

  it("reports needs_human so the page waits for staff, and stores no AI reply (PB-42)", async () => {
    const waiting = shopperExternalId(`token-${randomUUID()}`);
    expect(await receiveChannelMessage(web, { externalId: waiting, messageId: "w-1", text: "Chào shop" })).toBe("answered");
    const [{ id: conversationId }] = await db
      .from("conversations")
      .select("id, shoppers!inner(external_id)")
      .eq("shop_id", FX.a.shop)
      .eq("shoppers.external_id", waiting)
      .then(({ data }) => data!);
    const handed = await db.from("conversations").update({ mode: "needs_human" }).eq("id", conversationId);
    if (handed.error) throw new Error(handed.error.message);

    // needs_human still runs the engine (receive.ts), but its reply is dropped
    // (not_in_ai_mode): the shopper's message stays the last one.
    expect(await receiveChannelMessage(web, { externalId: waiting, messageId: "w-2", text: "Cho mình gặp nhân viên" })).toBe("stored");

    const waitingHistory = await loadHistory(FX.a.shop, waiting);
    expect(waitingHistory.mode).toBe("needs_human");
    expect(waitingHistory.messages.at(-1)).toMatchObject({ sender: "shopper", text: "Cho mình gặp nhân viên" });
    expect(chatStatus(waitingHistory.messages, waitingHistory.mode, false, true)).toBe("waiting_staff");

    // Staff hands it back to the AI: the next message gets an AI turn again.
    await db.from("conversations").update({ mode: "ai" }).eq("id", conversationId);
    expect(await receiveChannelMessage(web, { externalId: waiting, messageId: "w-3", text: "Váy còn size M không?" })).toBe("answered");
    const back = await loadHistory(FX.a.shop, waiting);
    expect(back.mode).toBe("ai");
    expect(chatStatus(back.messages, back.mode, false)).toBe("idle");
  });
});
