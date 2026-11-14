import { quickReplySchema, toolCallLogSchema, type ConversationMode, type HandoffReason, type ProductCard, type TablesInsert, type ToolContext } from "@/contract";
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
  conversation: { shopId: string; mode: ConversationMode } | null; // always null in staff_draft
  // description (PB-31): the shop's text, for details questions on the tool loop.
  product: { id: string; name: string; description?: string | null } | null;
  // customer only: the conversation's previous AI turn missed the product (its
  // ai_turns.postcheck.productMiss, or searchMissed for older rows) and did not
  // hand off. Missing means false.
  previousTurnMissedProduct?: boolean;
  // Last customer turn's quote, used only after its summary was shown to the
  // shopper. The engine checks the next shopper message before allowing a write.
  previousQuote?: PendingQuote | null;
  // PB-31: the previous AI turn offered staff for this reason (soft handoff) and
  // did not hand off. A "yes" now hands off with it. Missing means no offer.
  previousHandoffOffer?: HandoffReason | null;
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
  setAiMode?(ctx: ToolContext): Promise<void>;
  // Runs AFTER the reply is returned (see runEngine); returns the row id.
  insertTurn(row: TablesInsert<"ai_turns">): Promise<string>;
  // PB-10: every product of the shop with its colors and sizes, for the Jev
  // router (product choice, size/color matching). Optional: without it the router
  // only knows the product on screen.
  catalog?(shopId: string): Promise<CatalogItem[]>;
  // PB-31 AC12: up to 3 names of products the shop declared pairings for, as the
  // buttons under "phối cùng sản phẩm nào?". Only names that fit a quick reply.
  pairedProductNames?(shopId: string): Promise<string[]>;
};

const MAX_CARDS = 10;
const PAIRED_BUTTONS = 3;

// Every admin client reads the same database, so one cache per process is
// enough; it keeps the first store's client for its loads.
let sharedCatalog: ((shopId: string) => Promise<CatalogItem[]>) | null = null;

async function loadCatalog(db: Db, shopId: string): Promise<CatalogItem[]> {
  const [products, variants] = await Promise.all([
    db.from("products").select("id, name, category, description, price").eq("shop_id", shopId).order("name"),
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
      description: p.description,
      price: p.price,
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
      .select("id, name, description")
      .eq("id", productId)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error) throw new Error(`products: ${error.message}`);
    return data;
  }

  async function previousTurnState(shopId: string, conversationId: string) {
    const { data: rows, error } = await db
      .from("ai_turns")
      .select("tool_calls, handoff_reason, postcheck, handoff_offer")
      .eq("conversation_id", conversationId)
      .eq("shop_id", shopId)
      .eq("mode", "customer")
      // R3: pending and superseded rows are filtered in the query, so any number
      // of them never pushes the last delivered turn out of the limit.
      .is("postcheck->>pending", null)
      .is("postcheck->>superseded", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`ai_turns: ${error.message}`);
    // R3: a superseded turn's reply was never sent, so the shopper never saw its
    // offer, quote or clarifying question, and a pending one's may not be; the
    // last turn whose reply went out decides. (Filtered above; checked again here.)
    const data = rows.find((row) => {
      const postcheck = postcheckLogSchema.safeParse(row.postcheck).data;
      return postcheck?.superseded !== true && postcheck?.pending !== true;
    });
    if (!data || data.handoff_reason !== null) return { previousTurnMissedProduct: false, previousQuote: null, previousHandoffOffer: null };
    const logs = toolCallLogSchema.array().safeParse(data.tool_calls);
    // Rows the current engine wrote carry the guard's verdict in postcheck
    // (PB-05 AC3); older rows have none and fall back to the tool_calls shape.
    const postcheck = postcheckLogSchema.safeParse(data.postcheck);
    const missedProduct =
      postcheck.success && postcheck.data.productMiss !== undefined
        ? postcheck.data.productMiss
        : logs.success && searchMissed(logs.data);
    return {
      previousTurnMissedProduct: missedProduct,
      previousQuote: logs.success ? latestQuote(logs.data) : null,
      previousHandoffOffer: data.handoff_offer,
    };
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
      const [found, previous] = await Promise.all([
        product(conversation.shop_id, productId),
        previousTurnState(conversation.shop_id, conversationId!),
      ]);
      return {
        conversation: { shopId: conversation.shop_id, mode: conversation.mode },
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

    async pairedProductNames(shopId) {
      const { data: pairs, error } = await db.from("pairings").select("product_a_id, product_b_id").eq("shop_id", shopId);
      if (error) throw new Error(`pairings: ${error.message}`);
      const ids = [...new Set(pairs.flatMap((p) => [p.product_a_id, p.product_b_id]))];
      if (ids.length === 0) return [];
      const { data: products, error: productError } = await db.from("products").select("name").eq("shop_id", shopId).in("id", ids).order("name");
      if (productError) throw new Error(`products: ${productError.message}`);
      return products.map((p) => p.name.trim()).filter((name) => quickReplySchema.safeParse(name).success).slice(0, PAIRED_BUTTONS);
    },

    setNeedsHuman: (ctx) => setNeedsHuman(db, ctx),
    setAiMode: (ctx) => setAiMode(db, ctx),

    async insertTurn(row) {
      const { data, error } = await db.from("ai_turns").insert(row).select("id").single();
      if (error) throw new Error(`ai_turns: ${error.message}`);
      return data.id;
    },
  };
}

// R3 (receive.ts): a channel turn is logged pending (engine.ts); the channel
// marks it "delivered" (the reply went out, the next turn reads its state) or
// "superseded" (never sent: the next turn skips it). Other postcheck fields are
// kept as stored. Tried twice; a failure is logged, never thrown: the row then
// stays pending, which the next turn skips (the safe side).
export async function markTurn(db: Db, shopId: string, turnId: string, outcome: "delivered" | "superseded"): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (await markOnce(db, shopId, turnId, outcome, attempt === 2)) return true;
  }
  return false;
}

async function markOnce(db: Db, shopId: string, turnId: string, outcome: "delivered" | "superseded", last: boolean): Promise<boolean> {
  try {
    const { data, error } = await db.from("ai_turns").select("postcheck").eq("id", turnId).eq("shop_id", shopId).single();
    if (error) throw new Error(error.message);
    const stored = data.postcheck;
    const rest = { ...(stored !== null && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) };
    delete rest.pending;
    const postcheck = outcome === "superseded" ? { ...rest, superseded: true } : rest;
    const { error: updateError } = await db.from("ai_turns").update({ postcheck }).eq("id", turnId).eq("shop_id", shopId);
    if (updateError) throw new Error(updateError.message);
    return true;
  } catch (e) {
    if (last) console.error(`engine: failed to mark the turn ${outcome}`, e);
    return false;
  }
}
