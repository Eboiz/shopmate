import { toolCallLogSchema, type ConversationMode, type ProductCard, type TablesInsert, type ToolContext } from "@/contract";
import { searchMissed } from "./misunderstood";
import { sortSizes } from "./text";
import { setNeedsHuman } from "./tools/handoff-to-staff";
import type { Db } from "./types";

export type TurnContextArgs = {
  conversationId: string | null; // customer: set, shopId null
  shopId: string | null; // staff_draft: set (verified on the server), conversationId null
  productId: string | null;
};

export type TurnContext = {
  conversation: { shopId: string; mode: ConversationMode } | null; // always null in staff_draft
  product: { id: string; name: string } | null;
  // customer only: the conversation's previous AI turn searched for a product and
  // found nothing (see searchMissed), and did not hand off. Missing means false.
  previousTurnMissedProduct?: boolean;
};

export type EngineStore = {
  // ONE call for everything runEngine reads before calling the model. The store
  // chooses how (one query, or independent queries in parallel) and can change
  // that without touching runEngine. Every query still filters by shop_id: for a
  // customer, the product is returned only when it belongs to the conversation's
  // shop. Exactly one of conversationId and shopId must be set, otherwise it throws.
  // A mode other than "ai" is returned as it is; runEngine decides what to do.
  loadTurnContext(args: TurnContextArgs): Promise<TurnContext>;
  // Separate from loadTurnContext: it depends on the productIds the model returns.
  productCards(shopId: string, productIds: string[]): Promise<ProductCard[]>;
  setNeedsHuman(ctx: ToolContext): Promise<void>;
  // Runs AFTER the reply is returned (see runEngine); returns the row id.
  insertTurn(row: TablesInsert<"ai_turns">): Promise<string>;
};

const MAX_CARDS = 10;

export function createSupabaseStore(db: Db): EngineStore {
  async function product(shopId: string, productId: string | null) {
    if (productId === null) return null;
    const { data, error } = await db
      .from("products")
      .select("id, name")
      .eq("id", productId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error) throw new Error(`products: ${error.message}`);
    return data;
  }

  async function previousTurnMissed(shopId: string, conversationId: string): Promise<boolean> {
    const { data, error } = await db
      .from("ai_turns")
      .select("tool_calls, handoff_reason")
      .eq("conversation_id", conversationId)
      .eq("shop_id", shopId)
      .eq("mode", "customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ai_turns: ${error.message}`);
    if (!data || data.handoff_reason !== null) return false;
    const logs = toolCallLogSchema.array().safeParse(data.tool_calls);
    return logs.success && searchMissed(logs.data);
  }

  return {
    async loadTurnContext({ conversationId, shopId, productId }) {
      if ((conversationId === null) === (shopId === null)) {
        throw new Error("loadTurnContext needs exactly one of conversationId and shopId");
      }
      if (shopId !== null) return { conversation: null, product: await product(shopId, productId) };

      // The product's shop is the conversation's, so the two reads run in order.
      const { data: conversation, error } = await db
        .from("conversations")
        .select("shop_id, mode")
        .eq("id", conversationId!)
        .maybeSingle();
      if (error) throw new Error(`conversations: ${error.message}`);
      if (!conversation) return { conversation: null, product: null };
      const [found, previousTurnMissedProduct] = await Promise.all([
        product(conversation.shop_id, productId),
        previousTurnMissed(conversation.shop_id, conversationId!),
      ]);
      return {
        conversation: { shopId: conversation.shop_id, mode: conversation.mode },
        product: found,
        previousTurnMissedProduct,
      };
    },

    async productCards(shopId, productIds) {
      const ids = [...new Set(productIds)];
      if (ids.length === 0) return [];
      const [products, variants] = await Promise.all([
        db.from("products").select("id, name, price, image_url").eq("shop_id", shopId).in("id", ids),
        db.from("variants").select("product_id, size").eq("shop_id", shopId).in("product_id", ids).gt("stock", 0),
      ]);
      if (products.error) throw new Error(`products: ${products.error.message}`);
      if (variants.error) throw new Error(`variants: ${variants.error.message}`);

      return ids
        .flatMap((id) => {
          const p = products.data.find((row) => row.id === id);
          if (!p) return [];
          const sizes = variants.data.filter((v) => v.product_id === id).map((v) => v.size);
          return [{ productId: p.id, name: p.name, price: p.price, imageUrl: p.image_url, sizesInStock: sortSizes(sizes) }];
        })
        .slice(0, MAX_CARDS);
    },

    setNeedsHuman: (ctx) => setNeedsHuman(db, ctx),

    async insertTurn(row) {
      const { data, error } = await db.from("ai_turns").insert(row).select("id").single();
      if (error) throw new Error(`ai_turns: ${error.message}`);
      return data.id;
    },
  };
}
