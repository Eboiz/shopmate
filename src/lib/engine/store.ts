import { toolCallLogSchema, type ConversationMode, type ProductCard, type TablesInsert, type ToolContext } from "@/contract";
import type { CatalogItem } from "./jev";
import { searchMissed } from "./misunderstood";
import { latestQuote, type PendingQuote } from "./order-flow";
import { postcheckLogSchema } from "./postcheck-log";
import { sortSizes } from "./text";
import { setAiMode, setNeedsHuman } from "./tools/handoff-to-staff";
import { cachedCatalog } from "./turn-cache";
import type { Db } from "./types";

export type TurnContextArgs = {
  conversationId: string | null; // customer: set, shopId null
  shopId: string | null; // staff_draft: set (verified on the server), conversationId null
  productId: string | null;
};

export type TurnContext = {
  conversation: { shopId: string; mode: ConversationMode; lastMessageAt?: string } | null; // always null in staff_draft
  product: { id: string; name: string } | null;
  // customer only: the conversation's previous AI turn missed the product (its
  // ai_turns.postcheck.productMiss, or searchMissed for older rows) and did not
  // hand off. Missing means false.
  previousTurnMissedProduct?: boolean;
  // Last customer turn's quote, used only after its summary was shown to the
  // shopper. The engine checks the next shopper message before allowing a write.
  previousQuote?: PendingQuote | null;
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
  setAiMode?(ctx: ToolContext, lastMessageAt?: string): Promise<void>;
  // #8: needs_human -> ai only while messageId is the shopper's newest message
  // (one atomic UPDATE). Preferred over setAiMode when the turn has a messageId.
  resumeAiIfLatest?(ctx: ToolContext, messageId: string): Promise<boolean>;
  // The order already written from this confirmed quote (waits for a write of
  // it still in flight), or null. supersede: also mark a quote with no order
  // as replaced, so a later create of it writes nothing; set it right before a
  // re-quote is shown (#1).
  orderForQuote?(ctx: ToolContext, quoteKey: string, supersede: boolean): Promise<{ status: "created"; orderId: string; total: number } | null>;
  // Runs AFTER the reply is returned (see runEngine); returns the row id.
  insertTurn(row: TablesInsert<"ai_turns">): Promise<string>;
  // PB-10: every product of the shop with its colors and sizes, for the Jev
  // router (product choice, size/color matching). Optional: without it the router
  // only knows the product on screen.
  catalog?(shopId: string): Promise<CatalogItem[]>;
};

const MAX_CARDS = 10;

// Every admin client reads the same database, so one cache per process is
// enough; it keeps the first store's client for its loads.
let sharedCatalog: ((shopId: string) => Promise<CatalogItem[]>) | null = null;

async function loadCatalog(db: Db, shopId: string): Promise<CatalogItem[]> {
  const [products, variants] = await Promise.all([
    db.from("products").select("id, name, category").eq("shop_id", shopId).order("name"),
    db.from("variants").select("product_id, size, color").eq("shop_id", shopId),
  ]);
  if (products.error) throw new Error(`products: ${products.error.message}`);
  if (variants.error) throw new Error(`variants: ${variants.error.message}`);
  return products.data.map((p) => {
    const own = variants.data.filter((v) => v.product_id === p.id);
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      colors: [...new Set(own.map((v) => v.color))],
      sizes: sortSizes(own.map((v) => v.size)),
    };
  });
}

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

  async function previousTurnState(shopId: string, conversationId: string) {
    const { data, error } = await db
      .from("ai_turns")
      .select("id, tool_calls, handoff_reason, postcheck")
      .eq("conversation_id", conversationId)
      .eq("shop_id", shopId)
      .eq("mode", "customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`ai_turns: ${error.message}`);
    if (!data || data.handoff_reason !== null) return { previousTurnMissedProduct: false, previousQuote: null };
    const logs = toolCallLogSchema.array().safeParse(data.tool_calls);
    // Rows the current engine wrote carry the guard's verdict in postcheck
    // (PB-05 AC3); older rows have none and fall back to the tool_calls shape.
    const postcheck = postcheckLogSchema.safeParse(data.postcheck);
    const missedProduct =
      postcheck.success && postcheck.data.productMiss !== undefined
        ? postcheck.data.productMiss
        : logs.success && searchMissed(logs.data);
    // A create that succeeded in this row used the quote up: a late replay must
    // not mint a new key from the confirm turn's own row.
    const orderWritten = logs.success && logs.data.some((log) => log.name === "create_draft_order" && !log.error
      && (log.output as { status?: string } | undefined)?.status === "created");
    const quote = logs.success ? latestQuote(logs.data) : null;
    return {
      previousTurnMissedProduct: missedProduct,
      previousQuote: quote && !orderWritten ? { ...quote, quoteId: data.id } : null,
    };
  }

  return {
    async orderForQuote(ctx, quoteKey, supersede) {
      if (ctx.conversationId === null) return null;
      const { data, error } = await db.rpc("engine_order_for_quote", {
        p_shop_id: ctx.shopId,
        p_conversation_id: ctx.conversationId,
        p_quote_key: quoteKey,
        p_supersede: supersede,
      });
      if (error) throw new Error(`engine_order_for_quote: ${error.message}`);
      return (data ?? null) as { status: "created"; orderId: string; total: number } | null;
    },
    async loadTurnContext({ conversationId, shopId, productId }) {
      if ((conversationId === null) === (shopId === null)) {
        throw new Error("loadTurnContext needs exactly one of conversationId and shopId");
      }
      if (shopId !== null) return { conversation: null, product: await product(shopId, productId) };

      // The product's shop is the conversation's, so the two reads run in order.
      const { data: conversation, error } = await db
        .from("conversations")
        .select("shop_id, mode, last_message_at")
        .eq("id", conversationId!)
        .maybeSingle();
      if (error) throw new Error(`conversations: ${error.message}`);
      if (!conversation) return { conversation: null, product: null };
      const [found, previous] = await Promise.all([
        product(conversation.shop_id, productId),
        previousTurnState(conversation.shop_id, conversationId!),
      ]);
      return {
        conversation: { shopId: conversation.shop_id, mode: conversation.mode, lastMessageAt: conversation.last_message_at },
        product: found,
        ...previous,
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

    // F5: one read per shop every 30 s per process (names, colours, sizes only).
    catalog: (shopId) => (sharedCatalog ??= cachedCatalog((id) => loadCatalog(db, id)))(shopId),

    setNeedsHuman: (ctx) => setNeedsHuman(db, ctx),
    setAiMode: (ctx, lastMessageAt) => setAiMode(db, ctx, lastMessageAt),
    async resumeAiIfLatest(ctx, messageId) {
      if (ctx.conversationId === null) return false;
      const { data, error } = await db.rpc("engine_resume_ai", {
        p_shop_id: ctx.shopId,
        p_conversation_id: ctx.conversationId,
        p_message_id: messageId,
      });
      if (error) throw new Error(`engine_resume_ai: ${error.message}`);
      return data === true;
    },

    async insertTurn(row) {
      const { data, error } = await db.from("ai_turns").insert(row).select("id").single();
      if (error) throw new Error(`ai_turns: ${error.message}`);
      return data.id;
    },
  };
}
