import { beforeEach, describe, expect, it, vi } from "vitest";

// PB-24: saveSizeChart checks the chart, the role, then saves it in one RPC.
const auth = vi.hoisted(() => ({ role: "owner" as "owner" | "staff" }));
const rpc = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ refresh }));
vi.mock("@/lib/auth", () => ({ requireStaff: async () => ({ shopId: "shop-a", role: auth.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

const { saveSizeChart } = await import("./actions");

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
