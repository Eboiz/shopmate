import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { productCardSchema } from "@/contract";
import type { Json } from "@/contract/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseStore, markTurnSuperseded } from "./store";
import { FX, seedTwoShops } from "./test/two-shops";

const db = createAdminClient();
const store = createSupabaseStore(db);

describe("createSupabaseStore", () => {
  beforeAll(() => seedTwoShops(db));

  describe("loadTurnContext", () => {
    it("reads the conversation and the product in one call", async () => {
      expect(
        await store.loadTurnContext({ conversationId: FX.a.conversation, shopId: null, productId: FX.a.vay01 }),
      ).toEqual({
        conversation: { shopId: FX.a.shop, mode: "ai" },
        // PB-31: the description comes along for the tool-loop prompt (the fixture has none)
        product: { id: FX.a.vay01, name: "Váy suông linen", description: null },
        previousTurnMissedProduct: false,
        previousQuote: null,
        previousHandoffOffer: null,
      });
    });

    it("loads the last quoted order only from this customer's conversation", async () => {
      const items = [{ variantId: FX.a.vay01MBe, quantity: 1 }];
      const quote = { lines: [{
        variantId: FX.a.vay01MBe, productId: FX.a.vay01, name: "Váy suông linen",
        size: "M", color: "be", quantity: 1, unitPrice: 350000, lineTotal: 350000,
      }], total: 350000 };
      const id = await store.insertTurn({
        shop_id: FX.a.shop, conversation_id: FX.a.conversation, mode: "customer", latency_ms: 1,
        tool_calls: [{ name: "quote_order", input: { items }, output: quote }],
      });
      try {
        const own = await store.loadTurnContext({ conversationId: FX.a.conversation, shopId: null, productId: null });
        expect(own.previousQuote).toEqual({ items, quote });
        const other = await store.loadTurnContext({ conversationId: FX.b.conversation, shopId: null, productId: null });
        expect(other.previousQuote).toBeNull();
      } finally {
        await db.from("ai_turns").delete().eq("id", id);
      }
    });

    it("says whether the conversation's latest AI turn searched and found nothing (PB-05)", async () => {
      const turn = (tool_calls: Json[], handoff_reason: "misunderstood_twice" | null = null, postcheck?: Json) =>
        store.insertTurn({ shop_id: FX.a.shop, conversation_id: FX.a.conversation, mode: "customer", latency_ms: 1, tool_calls, handoff_reason, postcheck });
      const missed = () =>
        store.loadTurnContext({ conversationId: FX.a.conversation, shopId: null, productId: null }).then((tc) => tc.previousTurnMissedProduct);
      const emptySearch = { name: "search_products", input: { query: "áo khoác da", limit: 5 }, output: { products: [] } };

      await turn([emptySearch]);
      expect(await missed()).toBe(true);
      // Staff draft turns of the same shop don't count; only the conversation's own.
      await store.insertTurn({ shop_id: FX.a.shop, mode: "staff_draft", latency_ms: 1, tool_calls: [] });
      expect(await missed()).toBe(true);
      await turn([emptySearch, { name: "get_stock", input: { productId: FX.a.vay01 }, output: {} }]);
      expect(await missed()).toBe(false);
      await turn([emptySearch], "misunderstood_twice");
      expect(await missed()).toBe(false);
      await turn([]);
      expect(await missed()).toBe(false);
      // postcheck.productMiss wins over the tool_calls shape: a router clarifying
      // turn logs no search but missed; a logged false overrides an empty search.
      await turn([], null, { productMiss: true });
      expect(await missed()).toBe(true);
      await turn([emptySearch], null, { productMiss: false });
      expect(await missed()).toBe(false);
    });

    it("skips turns whose reply was superseded (R3): the last turn the shopper saw decides", async () => {
      const ids: string[] = [];
      const turn = async (fields: { handoff_offer?: "size_out_of_range" | null; postcheck?: Json }) => {
        const id = await store.insertTurn({ shop_id: FX.a.shop, conversation_id: FX.a.conversation, mode: "customer", latency_ms: 1, tool_calls: [], ...fields });
        ids.push(id);
        return id;
      };
      const offer = () =>
        store.loadTurnContext({ conversationId: FX.a.conversation, shopId: null, productId: null }).then((tc) => tc.previousHandoffOffer);
      try {
        await turn({ handoff_offer: null, postcheck: { productMiss: false } });
        // The older turn finished last, with an offer the shopper never saw.
        const late = await turn({ handoff_offer: "size_out_of_range", postcheck: { productMiss: false, numberCheck: { failed: [], retried: true } } });
        expect(await offer()).toBe("size_out_of_range");
        await markTurnSuperseded(db, FX.a.shop, late);
        expect(await offer()).toBeNull();
        // The mark keeps what postcheck already held.
        const { data } = await db.from("ai_turns").select("postcheck").eq("id", late).single();
        expect(data?.postcheck).toEqual({ productMiss: false, numberCheck: { failed: [], retried: true }, superseded: true });
        // Another shop's id is never marked.
        const other = await store.insertTurn({ shop_id: FX.b.shop, conversation_id: FX.b.conversation, mode: "customer", latency_ms: 1, tool_calls: [], postcheck: {} });
        ids.push(other);
        await markTurnSuperseded(db, FX.a.shop, other);
        const { data: otherRow } = await db.from("ai_turns").select("postcheck").eq("id", other).single();
        expect(otherRow?.postcheck).toEqual({});
      } finally {
        await db.from("ai_turns").delete().in("id", ids);
      }
    });

    it("returns nulls for an unknown conversation", async () => {
      expect(await store.loadTurnContext({ conversationId: randomUUID(), shopId: null, productId: FX.a.vay01 })).toEqual({
        conversation: null,
        product: null,
      });
    });

    it("returns the mode as it is; gating is runEngine's job", async () => {
      await db.from("conversations").update({ mode: "staff" }).eq("id", FX.a.conversation);
      try {
        const tc = await store.loadTurnContext({ conversationId: FX.a.conversation, shopId: null, productId: null });
        expect(tc.conversation).toEqual({ shopId: FX.a.shop, mode: "staff" });
      } finally {
        await db.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation);
      }
    });

    it("never returns another shop's product", async () => {
      const customer = await store.loadTurnContext({ conversationId: FX.a.conversation, shopId: null, productId: FX.b.vay01 });
      expect(customer.product).toBeNull();
      const staff = await store.loadTurnContext({ conversationId: null, shopId: FX.a.shop, productId: FX.b.vay01 });
      expect(staff.product).toBeNull();
      const own = await store.loadTurnContext({ conversationId: null, shopId: FX.a.shop, productId: FX.a.vay01 });
      expect(own).toEqual({ conversation: null, product: { id: FX.a.vay01, name: "Váy suông linen", description: null } });
    });

    it("needs exactly one of conversationId and shopId", async () => {
      await expect(
        store.loadTurnContext({ conversationId: FX.a.conversation, shopId: FX.a.shop, productId: null }),
      ).rejects.toThrow();
      await expect(store.loadTurnContext({ conversationId: null, shopId: null, productId: null })).rejects.toThrow();
    });
  });

  it("productCards keeps order and drops repeats and foreign ids", async () => {
    const cards = await store.productCards(FX.a.shop, [FX.a.ao03, FX.b.vay01, FX.a.vay01, FX.a.ao03, randomUUID()]);
    expect(cards.map((c) => c.productId)).toEqual([FX.a.ao03, FX.a.vay01]);
    for (const c of cards) productCardSchema.parse(c);
    expect(cards[1]).toEqual({
      productId: FX.a.vay01,
      name: "Váy suông linen",
      price: 350000,
      imageUrl: null,
      sizesInStock: ["M"],
    });
    expect(await store.productCards(FX.a.shop, [])).toEqual([]);
  });

  it("setNeedsHuman hands off the conversation", async () => {
    await store.setNeedsHuman({ shopId: FX.a.shop, conversationId: FX.a.conversation });
    const { data } = await db.from("conversations").select("mode").eq("id", FX.a.conversation).single();
    expect(data?.mode).toBe("needs_human");
    await db.from("conversations").update({ mode: "ai" }).eq("id", FX.a.conversation);
  });

  describe("catalog (PB-10)", () => {
    it("lists only this shop's products, with their colors and sizes", async () => {
      const a = await store.catalog!(FX.a.shop);
      const b = await store.catalog!(FX.b.shop);
      const vay = a.find((p) => p.id === FX.a.vay01)!;
      expect(vay).toMatchObject({ name: "Váy suông linen", category: "váy" });
      expect(vay.colors).toEqual(expect.arrayContaining(["be"]));
      expect(vay.sizes).toEqual(expect.arrayContaining(["M", "L"]));
      expect(a.some((p) => p.id === FX.b.vay01)).toBe(false);
      expect(b.some((p) => p.id === FX.a.vay01)).toBe(false);
      expect(await store.catalog!(randomUUID())).toEqual([]);
    });
  });

  describe("pairedProductNames (PB-31 AC12)", () => {
    it("names the shop's paired products only, sorted, as quick replies", async () => {
      expect(await store.pairedProductNames!(FX.a.shop)).toEqual(["Áo sơ mi trắng", "Váy suông linen"]);
      // Shop B declared no pairing: no button, and never shop A's products.
      expect(await store.pairedProductNames!(FX.b.shop)).toEqual([]);
    });
  });

  describe("insertTurn", () => {
    it("writes the metrics columns", async () => {
      const id = await store.insertTurn({
        shop_id: FX.a.shop,
        conversation_id: FX.a.conversation,
        mode: "customer",
        latency_ms: 12,
        tool_calls: [],
        input_tokens: 3,
        output_tokens: 4,
        ttft_ms: 7,
        model_calls: 2,
        model: "m",
        prompt_version: "v0",
      });
      const { data } = await db.from("ai_turns").select("*").eq("id", id).single();
      expect(data).toMatchObject({
        shop_id: FX.a.shop,
        conversation_id: FX.a.conversation,
        mode: "customer",
        latency_ms: 12,
        tool_calls: [],
        input_tokens: 3,
        output_tokens: 4,
        ttft_ms: 7,
        model_calls: 2,
        model: "m",
        prompt_version: "v0",
      });
    });

    it("defaults the new columns for rows that leave them out", async () => {
      const id = await store.insertTurn({ shop_id: FX.a.shop, mode: "staff_draft", latency_ms: 5 });
      const { data } = await db.from("ai_turns").select("*").eq("id", id).single();
      expect(data).toMatchObject({ ttft_ms: null, model_calls: 0, model: null, prompt_version: null });
    });
  });
});
