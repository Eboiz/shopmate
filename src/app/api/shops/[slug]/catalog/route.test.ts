import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatErrors } from "@/lib/chat/request";
import { shopCatalogSchema } from "@/lib/shop/types";

type Variant = { color: string; size: string; stock: number };
type SizeRow = { size: string; height_min_cm: number; height_max_cm: number; weight_min_kg: number; weight_max_kg: number };
let products: { id: string; name: string; price: number; image_url: string | null; category: string | null; description: string | null; variants: Variant[]; size_charts: SizeRow[] }[];
let policies: { kind: string; content: string }[];
let failure: string | null;
const filters: [string, unknown][] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => (filters.push([`${table}.${k}`, v]), chain),
        maybeSingle: async () => ({
          data: filters.some(([k, v]) => k === "shops.slug" && v === "may-boutique") ? { id: "shop-a", name: "Mây Boutique" } : null,
          error: null,
        }),
        order: async () => (failure ? { data: null, error: { message: failure } } : { data: products, error: null }),
        in: async () => ({ data: policies, error: null }),
      };
      return chain;
    },
  }),
}));

const { GET } = await import("./route");
const get = (slug: string) =>
  GET(new NextRequest(`http://localhost/api/shops/${slug}/catalog`), { params: Promise.resolve({ slug }) });

beforeEach(() => {
  filters.length = 0;
  failure = null;
  policies = [{ kind: "giao_hang", content: " Giao toàn quốc 2–4 ngày. " }];
  products = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Váy suông linen",
      price: 350000,
      image_url: "https://x.supabase.co/storage/v1/object/public/product-images/a.jpg",
      category: "vay",
      description: "Linen mát.",
      size_charts: [
        { size: "M", height_min_cm: 156, height_max_cm: 162, weight_min_kg: 47, weight_max_kg: 53 },
        { size: "S", height_min_cm: 150, height_max_cm: 156, weight_min_kg: 42, weight_max_kg: 47 },
      ],
      variants: [
        { color: "Trắng", size: "L", stock: 2 },
        { color: "Be", size: "M", stock: 1 },
        { color: "Be", size: "S", stock: 4 },
        { color: "Đen", size: "XL", stock: 0 },
      ],
    },
    { id: "22222222-2222-4222-8222-222222222222", name: "Áo hết hàng", price: 200000, image_url: null, category: null, description: null, size_charts: [], variants: [{ color: "Đỏ", size: "M", stock: 0 }] },
  ];
});

describe("GET /api/shops/[slug]/catalog", () => {
  it("lists the slug's products with in-stock colors and sizes in the shape the page parses", async () => {
    const response = await get("may-boutique");
    expect(response.status).toBe(200);
    const body = shopCatalogSchema.parse(await response.json());
    expect(body.shop).toEqual({ name: "Mây Boutique", policies: { returns: "", shipping: "Giao toàn quốc 2–4 ngày." } });
    expect(body.products[0]).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Váy suông linen",
      price: 350000,
      imageUrl: "https://x.supabase.co/storage/v1/object/public/product-images/a.jpg",
      colors: ["Be", "Trắng"],
      sizesInStock: ["S", "M", "L"],
      category: "vay",
      description: "Linen mát.",
      variants: [
        { color: "Trắng", size: "L", stock: 2 },
        { color: "Be", size: "M", stock: 1 },
        { color: "Be", size: "S", stock: 4 },
      ],
      // Sorted by height, so the page and the finder read it top to bottom.
      sizeChart: [
        { size: "S", heightMinCm: 150, heightMaxCm: 156, weightMinKg: 42, weightMaxKg: 47 },
        { size: "M", heightMinCm: 156, heightMaxCm: 162, weightMinKg: 47, weightMaxKg: 53 },
      ],
    });
    expect(body.products[1]).toMatchObject({ colors: [], sizesInStock: [] });
    expect(filters).toContainEqual(["products.shop_id", "shop-a"]);
  });

  it("answers 404 for an unknown or malformed slug", async () => {
    expect((await get("khong-co")).status).toBe(404);
    const bad = await get("..%2Fadmin");
    expect(bad.status).toBe(404);
    expect(await bad.json()).toEqual({ error: chatErrors.shopNotFound });
  });

  it("returns a Vietnamese error when the read fails", async () => {
    failure = "db down";
    const response = await get("may-boutique");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: chatErrors.catalogFailed });
  });
});
