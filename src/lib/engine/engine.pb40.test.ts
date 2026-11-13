// PB-40: whatever path built the reply, its cards keep to the shopper's budget,
// excluded garments and count, and its buttons don't push a size other than the
// shopper's. Enforced by the server after the model, never left to it.
import { describe, expect, it, vi } from "vitest";
import { engineOutputSchema, type EngineInput, type ProductCard } from "@/contract";
import { runEngine, type EngineDeps } from "./engine";
import type { CatalogItem } from "./jev";
import type { EngineStore, TurnContext } from "./store";
import { finalJson, scriptedModel, toolCalls, toolUse } from "./test/fake-model";
import type { Db, ToolHandlers } from "./types";

const SHOP = "a0000000-0000-4000-8000-000000000001";
const CONV = "a0000000-0000-4000-8000-000000000031";
const id = (n: string) => `a0000000-0000-4000-8000-0000000000${n}`;
const PENCIL = id("51");
const A_LINE = id("52");
const DRESS = id("53");
const SHIRT = id("54");
const TROUSERS = id("55");
const VAY = id("11");

const products: Array<CatalogItem & { price: number }> = [
  { id: PENCIL, name: "Chân váy bút chì", category: "chan_vay", price: 300000, colors: ["trắng"], sizes: ["M"] },
  { id: A_LINE, name: "Chân váy chữ A", category: "chan_vay", price: 260000, colors: ["trắng"], sizes: ["M"] },
  { id: DRESS, name: "Đầm sơ mi thắt eo", category: "vay", price: 450000, colors: ["trắng"], sizes: ["M"] },
  { id: SHIRT, name: "Áo sơ mi lụa", category: "ao", price: 280000, colors: ["trắng"], sizes: ["M"] },
  { id: TROUSERS, name: "Quần tây ống đứng", category: "quan", price: 290000, colors: ["đen"], sizes: ["M"] },
];
const card = (productId: string): ProductCard => {
  const p = products.find((x) => x.id === productId)!;
  return { productId, name: p.name, price: p.price, imageUrl: null, sizesInStock: ["M"] };
};

function setup(responses: Parameters<typeof scriptedModel>[0], handlers: Partial<Record<string, unknown>> = {}) {
  const context: TurnContext = { conversation: { shopId: SHOP, mode: "ai" }, product: null };
  const store = {
    loadTurnContext: vi.fn<EngineStore["loadTurnContext"]>(async () => context),
    productCards: vi.fn<EngineStore["productCards"]>(async (_shop, ids) => ids.map(card)),
    setNeedsHuman: vi.fn<EngineStore["setNeedsHuman"]>(async () => {}),
    insertTurn: vi.fn<EngineStore["insertTurn"]>(async () => "turn-1"),
    catalog: vi.fn(async () => products),
  };
  const deps: Partial<EngineDeps> = {
    model: scriptedModel(responses),
    store,
    handlers: {
      search_products: vi.fn(async () => ({ match: "exact", products: [] })),
      ...handlers,
    } as unknown as ToolHandlers,
    db: {} as Db,
    now: () => 0,
    modelName: "test-model",
    onMetrics: () => {},
    staffShopId: SHOP,
  };
  return (input: EngineInput) => runEngine(input, deps);
}

const BOT_04 = "Tôi có 300 nghìn, muốn đồ đi làm màu trắng, không thích váy. Gợi ý 2 món phù hợp có giá dưới ngân sách";

describe("PB-40: the server keeps the reply to the shopper's constraints", () => {
  it("BOT-04 (staff_draft, tool loop): skirts, a dress over budget and a third item are dropped from the cards", async () => {
    const run = setup([
      toolCalls(toolUse("search_products", { query: "đồ đi làm trắng", limit: 5 })),
      finalJson({ text: "Gợi ý cho khách", productIds: [PENCIL, A_LINE, DRESS, SHIRT, TROUSERS], quickReplies: [] }),
    ]);
    const { output } = await run({ mode: "staff_draft", history: [{ sender: "shopper", text: BOT_04 }] });
    expect(output.reply.products.map((p) => p.productId)).toEqual([SHIRT, TROUSERS]);
    expect(() => engineOutputSchema.parse(output)).not.toThrow();
  });

  it("no constraint in the message: the model's cards are kept", async () => {
    const run = setup([finalJson({ text: "Dạ đây ạ", productIds: [PENCIL, DRESS], quickReplies: [] })]);
    const { output } = await run({ mode: "staff_draft", history: [{ sender: "shopper", text: "shop có chân váy và đầm không" }] });
    expect(output.reply.products.map((p) => p.productId)).toEqual([PENCIL, DRESS]);
  });

  it("BOT-02 (customer, tool loop): buttons for another size than the one asked are dropped", async () => {
    const stock = {
      productId: VAY,
      name: "Váy",
      price: 350000,
      variants: [
        { variantId: id("61"), size: "S", color: "trắng", stock: 2 },
        { variantId: id("62"), size: "M", color: "trắng", stock: 0 },
        { variantId: id("63"), size: "L", color: "trắng", stock: 3 },
        { variantId: id("64"), size: "XL", color: "trắng", stock: 1 },
        { variantId: id("65"), size: "M", color: "xanh nhạt", stock: 5 },
      ],
    };
    const run = setup(
      [
        toolCalls(toolUse("get_stock", { productId: VAY })),
        finalJson({ text: "M trắng hết rồi ạ", productIds: [], quickReplies: ["S trắng", "L trắng", "XL trắng", "Size M xanh nhạt"] }),
      ],
      { get_stock: vi.fn(async () => stock) },
    );
    const { output } = await run({
      mode: "customer",
      conversationId: CONV,
      history: [
        { sender: "shopper", text: "mình cao 160cm nặng 50kg" },
        { sender: "ai", text: "Bạn mặc size M nhé" },
        { sender: "shopper", text: "màu trắng size M còn không?" },
      ],
    });
    expect(output.reply.quickReplies).toEqual(["Size M xanh nhạt"]);
  });
});
