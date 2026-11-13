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

const { saveProduct, saveSizeChart } = await import("./actions");

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
