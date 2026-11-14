import { beforeEach, describe, expect, it, vi } from "vitest";

// PB-24: saveSizeChart checks the chart, the role, then saves it in one RPC.
// saveProduct writes the price and the changed stock rows of one product.
const auth = vi.hoisted(() => ({ role: "owner" as "owner" | "staff" }));
const rpc = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
// A stand-in for db.from(table).update(values).eq(...).select(): records each
// write and answers with what `answer` returns for it.
type Write = { table: string; values: Record<string, unknown>; filters: Record<string, unknown> };
const writes = vi.hoisted(() => [] as Write[]);
const answer = vi.hoisted(() => ({ fn: (...[]: [Write]) => ({ data: [{ id: "x" }] as unknown[] | null, error: null as { code?: string } | null }) }));
const from = vi.hoisted(() => (table: string) => ({
  update: (values: Record<string, unknown>) => {
    const write: Write = { table, values, filters: {} };
    const chain = {
      eq: (column: string, value: unknown) => ((write.filters[column] = value), chain),
      select: async () => (writes.push(write), answer.fn(write)),
    };
    return chain;
  },
}));

vi.mock("next/cache", () => ({ refresh }));
vi.mock("@/lib/auth", () => ({ requireStaff: async () => ({ shopId: "shop-a", role: auth.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

const { saveProduct, saveProductImages, saveShopProfile, saveSizeChart } = await import("./actions");

const form = (rows: unknown) => {
  const data = new FormData();
  data.set("productId", "product-1");
  data.set("rows", JSON.stringify(rows));
  return data;
};
const S = { size: "S", heightMin: "150", heightMax: "155", weightMin: "40", weightMax: "45" };
const M = { size: "M", heightMin: "156", heightMax: "162", weightMin: "46", weightMax: "52" };

describe("saveSizeChart", () => {
  beforeEach(() => {
    auth.role = "owner";
    rpc.mockReset().mockResolvedValue({ data: 2, error: null });
    refresh.mockReset();
  });

  it("saves the whole chart as numbers and refreshes the page", async () => {
    expect(await saveSizeChart({ error: null }, form([S, M]))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("save_size_chart", {
      p_product_id: "product-1",
      p_rows: [
        { size: "S", height_min_cm: 150, height_max_cm: 155, weight_min_kg: 40, weight_max_kg: 45 },
        { size: "M", height_min_cm: 156, height_max_cm: 162, weight_min_kg: 46, weight_max_kg: 52 },
      ],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("treats an emptied chart as saved, not as not found", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await saveSizeChart({ error: null }, form([]))).toEqual({ error: null });
  });

  it("stops an overlapping chart before the database", async () => {
    const state = await saveSizeChart({ error: null }, form([S, { ...M, heightMin: "155" }]));
    expect(state.error).toContain("chồng khoảng chiều cao");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tells staff only the owner may edit", async () => {
    auth.role = "staff";
    expect((await saveSizeChart({ error: null }, form([S]))).error).toBe("Chỉ chủ shop được sửa dữ liệu này.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["23P01", "Có 2 size chồng khoảng chiều cao hoặc cân nặng. Hãy sửa rồi lưu lại."],
    ["23505", "Có size bị lặp. Mỗi size chỉ một dòng."],
    ["P0002", "Không tìm thấy dữ liệu, hãy tải lại trang."],
    ["42501", "Chỉ chủ shop được sửa dữ liệu này."],
  ])("explains database error %s and keeps what was typed", async (code, message) => {
    rpc.mockResolvedValue({ data: null, error: { code } });
    const state = await saveSizeChart({ error: null }, form([S]));
    expect(state.error).toBe(message);
    expect(state.values?.rows).toBe(JSON.stringify([S]));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("saveProduct", () => {
  const productForm = (price: string, stocks: unknown) => {
    const data = new FormData();
    data.set("productId", "product-1");
    data.set("price", price);
    data.set("stocks", JSON.stringify(stocks));
    return data;
  };

  beforeEach(() => {
    auth.role = "owner";
    writes.length = 0;
    answer.fn = () => ({ data: [{ id: "x" }], error: null });
    refresh.mockReset();
  });

  it("saves the price and each changed row of this product in this shop", async () => {
    expect(await saveProduct({ error: null }, productForm("390000", [{ variantId: "v1", stock: "7" }]))).toEqual({ error: null });
    expect(writes).toEqual([
      { table: "products", values: { price: 390000 }, filters: { id: "product-1", shop_id: "shop-a" } },
      { table: "variants", values: { stock: 7 }, filters: { id: "v1", product_id: "product-1", shop_id: "shop-a" } },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("writes nothing when a row is not a stock number", async () => {
    const state = await saveProduct({ error: null }, productForm("390000", [{ variantId: "v1", stock: "bảy" }]));
    expect(state.error).toBe("Tồn kho phải là số nguyên từ 0 trở lên");
    expect(writes).toEqual([]);
  });

  it("stops before the stock when the product is not found", async () => {
    answer.fn = (write) => ({ data: write.table === "products" ? [] : [{ id: "x" }], error: null });
    const state = await saveProduct({ error: null }, productForm("390000", [{ variantId: "v1", stock: "7" }]));
    expect(state.error).toBe("Không tìm thấy dữ liệu, hãy tải lại trang.");
    expect(writes.map((write) => write.table)).toEqual(["products"]);
  });

  it("reports a stock row that matched nothing and keeps what was typed", async () => {
    answer.fn = (write) => ({ data: write.table === "variants" ? [] : [{ id: "x" }], error: null });
    const state = await saveProduct({ error: null }, productForm("390000", [{ variantId: "v9", stock: "7" }]));
    expect(state.error).toBe("Không tìm thấy dữ liệu, hãy tải lại trang.");
    expect(state.values?.price).toBe("390000");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("tells staff only the owner may edit", async () => {
    auth.role = "staff";
    expect((await saveProduct({ error: null }, productForm("390000", []))).error).toBe("Chỉ chủ shop được sửa dữ liệu này.");
    expect(writes).toEqual([]);
  });
});

// PB-32: photo list and shop profile.
const PUBLIC = "https://abc.supabase.co/storage/v1/object/public";

describe("saveProductImages", () => {
  const images = (urls: unknown) => {
    const data = new FormData();
    data.set("productId", "product-1");
    data.set("urls", JSON.stringify(urls));
    return data;
  };

  beforeEach(() => {
    auth.role = "owner";
    rpc.mockReset().mockResolvedValue({ data: 2, error: null });
    refresh.mockReset();
  });

  it("saves the photos in the given order and refreshes the page", async () => {
    const urls = [`${PUBLIC}/product-images/shop-a/p1/b.webp`, `${PUBLIC}/product-images/SP01.jpg`];
    expect(await saveProductImages({ error: null }, images(urls))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("save_product_images", { p_product_id: "product-1", p_urls: urls });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("treats an emptied list as saved", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await saveProductImages({ error: null }, images([]))).toEqual({ error: null });
  });

  it("refuses a URL outside the project's product-images bucket, before any write", async () => {
    const result = await saveProductImages({ error: null }, images(["https://evil.example/a.jpg"]));
    expect(result.error).toMatch(/không phải ảnh tải lên/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses more than 8 photos and repeated photos", async () => {
    const many = Array.from({ length: 9 }, (_, i) => `${PUBLIC}/product-images/shop-a/p1/${i}.webp`);
    expect((await saveProductImages({ error: null }, images(many))).error).toMatch(/tối đa 8 ảnh/);
    const twice = [many[0], many[0]];
    expect((await saveProductImages({ error: null }, images(twice))).error).toMatch(/bị lặp/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tells staff it is owner-only without writing", async () => {
    auth.role = "staff";
    expect((await saveProductImages({ error: null }, images([]))).error).toBe("Chỉ chủ shop được sửa dữ liệu này.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an RLS refusal from the database to the owner-only message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await saveProductImages({ error: null }, images([]))).error).toBe("Chỉ chủ shop được sửa dữ liệu này.");
  });
});

describe("saveShopProfile", () => {
  const profile = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ address: "", phone: "", fanpageUrl: "", bannerUrl: "", ...fields })) data.set(key, value);
    return data;
  };

  beforeEach(() => {
    auth.role = "owner";
    writes.length = 0;
    answer.fn = () => ({ data: [{ id: "shop-a" }], error: null });
    refresh.mockReset();
  });

  it("saves the trimmed fields of the signed-in shop, empty ones as null", async () => {
    const result = await saveShopProfile(
      { error: null },
      profile({ address: " 12 Lê Lợi ", phone: "0901 234 567", bannerUrl: `${PUBLIC}/shop-banners/shop-a/b.webp` }),
    );
    expect(result).toEqual({ error: null });
    expect(writes).toEqual([
      {
        table: "shops",
        values: { address: "12 Lê Lợi", phone: "0901 234 567", fanpage_url: null, banner_url: `${PUBLIC}/shop-banners/shop-a/b.webp` },
        filters: { id: "shop-a" },
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("clears the banner when the field is empty (back to the default photo)", async () => {
    await saveShopProfile({ error: null }, profile({}));
    expect(writes[0].values.banner_url).toBeNull();
  });

  it("refuses a bad phone, an http fanpage or a banner from elsewhere, keeping what was typed", async () => {
    const phone = await saveShopProfile({ error: null }, profile({ phone: "abc" }));
    expect(phone.error).toMatch(/Số điện thoại/);
    expect(phone.values?.phone).toBe("abc");
    expect((await saveShopProfile({ error: null }, profile({ fanpageUrl: "http://fb.com/x" }))).error).toMatch(/https:\/\//);
    expect((await saveShopProfile({ error: null }, profile({ bannerUrl: `${PUBLIC}/product-images/a.jpg` }))).error).toMatch(/Ảnh bìa/);
    expect(writes).toEqual([]);
  });

  it("reads an update RLS hid (no row back) as not allowed or not found", async () => {
    answer.fn = () => ({ data: [], error: null });
    expect((await saveShopProfile({ error: null }, profile({}))).error).toBe("Không tìm thấy dữ liệu, hãy tải lại trang.");
  });

  it("tells staff it is owner-only without writing", async () => {
    auth.role = "staff";
    expect((await saveShopProfile({ error: null }, profile({}))).error).toBe("Chỉ chủ shop được sửa dữ liệu này.");
    expect(writes).toEqual([]);
  });
});
