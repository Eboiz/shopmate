import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/contract";
import type { Db } from "../types";
import { ToolError } from "../types";

// PB-30 photo branch of search_products, through the real photo-search client
// with a fake fetch. The text branch is covered by search-products.int.test.ts.
import { PHOTO_SIMILAR_MIN } from "../photo-search";
import { searchProducts } from "./search-products";

type Answer = { hits: { productId: string; score: number }[]; reranked: boolean } | Error;
let answer: Answer;
const calls: Record<string, unknown>[] = [];
const searchByPhoto = {
  mockResolvedValue: (a: Answer) => void (answer = a),
  mockReset: () => void (calls.length = 0),
};

const SHOP = "a0000000-0000-4000-8000-000000000001";
const id = (n: number) => `a0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const products = [1, 2, 3, 4, 5].map((n) => ({
  id: id(n), name: `Áo khoác ${n}`, category: "áo khoác", price: 100000 * n, image_url: null, description: null,
}));
const photo = { base64: "aGVsbG8=", mediaType: "image/jpeg" as const };
const ctx: ToolContext = { shopId: SHOP, conversationId: "c", photos: [photo] };
const SIMILAR = PHOTO_SIMILAR_MIN.reranked;

function fakeDb() {
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => ((filters[k] = v), chain),
      in: (k: string, v: unknown) => ((filters[k] = v), chain),
      order: () => chain,
      then: (resolve: (v: unknown) => void) => {
        if (table === "products") {
          const rows = products.filter((p) => filters.shop_id === SHOP && (!filters.id || (filters.id as string[]).includes(p.id)));
          return resolve({ data: rows, error: null });
        }
        return resolve({ data: [{ product_id: id(1), size: "M", color: "Đen" }], error: null });
      },
    };
    return chain;
  });
  return { db: { from } as unknown as Db, from };
}

beforeEach(() => {
  searchByPhoto.mockReset();
  vi.stubEnv("EMBEDDER_URL", "https://gpu.test");
  vi.stubEnv("EMBEDDER_TOKEN", "tok");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    if (answer instanceof Error) return new Response("down", { status: 503 });
    return new Response(JSON.stringify({ ...answer, model: "m", dim: 768 }));
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("search_products with a photo (PB-30)", () => {
  it("searches the shop by the numbered photo with the query as text; a photo match is close, in the service's order", async () => {
    searchByPhoto.mockResolvedValue({ hits: [{ productId: id(3), score: 0.9 }, { productId: id(1), score: 0.85 }], reranked: true });
    const out = await searchProducts({ query: "áo khoác đen", limit: 5, photo: 1 }, ctx, fakeDb().db);
    expect(calls).toEqual([{ shopId: SHOP, imageBase64: photo.base64, mediaType: "image/jpeg", text: "áo khoác đen", limit: 10 }]);
    expect(out.match).toBe("close");
    expect(out.products.map((p) => p.productId)).toEqual([id(3), id(1)]);
    expect(out.products[1]).toMatchObject({ name: "Áo khoác 1", colors: ["Đen"], sizes: ["M"] });
  });

  it("only similar hits: match close, at most 3 products", async () => {
    searchByPhoto.mockResolvedValue({ hits: [1, 2, 3, 4, 5].map((n) => ({ productId: id(n), score: SIMILAR + 0.01 * n })), reranked: true });
    const out = await searchProducts({ query: "áo", limit: 5, photo: 1 }, ctx, fakeDb().db);
    expect(out.match).toBe("close");
    expect(out.products).toHaveLength(3);
  });

  it("nothing above the floor: match none", async () => {
    searchByPhoto.mockResolvedValue({ hits: [{ productId: id(1), score: SIMILAR - 0.01 }], reranked: true });
    expect(await searchProducts({ query: "áo", limit: 5, photo: 1 }, ctx, fakeDb().db)).toEqual({ match: "none", products: [] });
  });

  it("drops hit ids that are not products of ctx.shopId", async () => {
    searchByPhoto.mockResolvedValue({ hits: [{ productId: "b0000000-0000-4000-8000-000000000099", score: 0.9 }, { productId: id(2), score: 0.85 }], reranked: true });
    const out = await searchProducts({ query: "áo", limit: 5, photo: 1 }, ctx, fakeDb().db);
    expect(out.products.map((p) => p.productId)).toEqual([id(2)]);
  });

  it("falls back to text search when the photo search is unavailable, still close", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    searchByPhoto.mockResolvedValue(new Error("503"));
    const out = await searchProducts({ query: "Áo khoác 2", limit: 5, photo: 1 }, ctx, fakeDb().db);
    expect(out.match).toBe("close");
    expect(out.products.length).toBeGreaterThan(0);
    expect(out.products.length).toBeLessThanOrEqual(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back"), "photo search answered 503");
    warn.mockRestore();
  });

  it("a photo number the shopper did not send is photo_not_found", async () => {
    await expect(searchProducts({ query: "áo", limit: 5, photo: 2 }, ctx, fakeDb().db)).rejects.toEqual(new ToolError("photo_not_found"));
    await expect(searchProducts({ query: "áo", limit: 5, photo: 1 }, { ...ctx, photos: [] }, fakeDb().db)).rejects.toEqual(new ToolError("photo_not_found"));
    expect(calls).toEqual([]);
  });
});
