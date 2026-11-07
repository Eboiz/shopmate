// PB-05 AC5: search_products and get_stock on the PB-02 demo seed (the data the
// shop front and the demo use), not only on the small two-shop fixture. The CSV
// files are loaded into a throwaway local shop with fixed ids, so the test needs
// neither `pnpm db:seed` nor the real demo shop.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDemoData, SHEET_COLUMNS, type SheetName } from "@/lib/seed/sheet";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertLocalDb } from "../test/two-shops";
import { fold } from "../text";
import { getStock } from "./get-stock";
import { searchProducts } from "./search-products";

const csv = Object.fromEntries(
  (Object.keys(SHEET_COLUMNS) as SheetName[]).map((sheet) => [
    sheet,
    readFileSync(path.join(process.cwd(), "supabase", "seed", "demo", `${sheet}.csv`), "utf8"),
  ]),
) as Record<SheetName, string>;
const parsed = readDemoData(csv);
if (!parsed.data) throw new Error(`Invalid PB-02 demo seed: ${parsed.errors.join("; ")}`);
const demo = parsed.data;

const SHOP = "d0000000-0000-4000-8000-000000000001";
const pad = (n: number) => String(n).padStart(12, "0");
const productId = new Map(demo.products.map((p, i) => [p.code, `d0000000-0000-4000-8001-${pad(i + 1)}`]));
const id = (code: string) => {
  const value = productId.get(code);
  if (!value) throw new Error(`Unknown demo product ${code}`);
  return value;
};
const product = (code: string) => demo.products.find((p) => p.code === code)!;
const ctx = { shopId: SHOP, conversationId: null };
const db = createAdminClient();

async function must(what: string, query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
}

describe("search_products and get_stock on the PB-02 demo seed (PB-05)", () => {
  beforeAll(async () => {
    assertLocalDb();
    await must("delete shop", db.from("shops").delete().eq("id", SHOP));
    await must("shop", db.from("shops").insert({ id: SHOP, name: "PB-05 demo seed test", slug: "pb05-demo-seed-test" }));
    await must(
      "products",
      db.from("products").insert(
        demo.products.map((p) => ({
          id: id(p.code), shop_id: SHOP, code: p.code, name: p.name, category: p.category, price: p.price,
        })),
      ),
    );
    await must(
      "variants",
      db.from("variants").insert(
        demo.variants.map((v) => ({ shop_id: SHOP, product_id: id(v.code), size: v.size, color: v.color, stock: v.stock })),
      ),
    );
  });

  afterAll(async () => {
    await db.from("shops").delete().eq("id", SHOP);
  });

  it('AC4: "vay suong linen" finds "Váy suông linen" with its price from the data', async () => {
    const { products } = await searchProducts({ query: "vay suong linen", limit: 5 }, ctx, db);
    expect(products.map((p) => p.name)).toEqual(["Váy suông linen"]);
    expect(products[0].productId).toBe(id("VAY01"));
    expect(products[0].price).toBe(product("VAY01").price);
  });

  it("finds every demo product by its name typed without diacritics", async () => {
    for (const p of demo.products) {
      const { products } = await searchProducts({ query: fold(p.name), limit: 10 }, ctx, db);
      expect(products.map((x) => x.productId), p.name).toContain(id(p.code));
    }
  });

  // The PO test set's S4 scenario (test_questions 25-26): a coat the shop doesn't sell.
  it("returns no product for a name the shop doesn't sell (AC3 starts from here)", async () => {
    expect(await searchProducts({ query: "áo măng tô", limit: 5 }, ctx, db)).toEqual({ products: [] });
    expect(await searchProducts({ query: "ao mang to toi goi", limit: 5 }, ctx, db)).toEqual({ products: [] });
  });

  it("AC1: one size and color in stock gives its stock and the product price", async () => {
    const out = await getStock({ productId: id("VAY01"), size: "M", color: "be" }, ctx, db);
    const want = demo.variants.find((v) => v.code === "VAY01" && v.size === "M" && v.color === "be")!;
    expect(want.stock).toBeGreaterThan(0);
    expect(out.price).toBe(product("VAY01").price);
    expect(out.variants).toEqual([expect.objectContaining({ size: "M", color: "be", stock: want.stock })]);
  });

  it("AC2: a sold-out variant shows stock 0, and the unfiltered call lists the same item's variants in stock", async () => {
    // VAY01 black / M is 0 in the seed; be S, M and L, black S are in stock.
    const asked = await getStock({ productId: id("VAY01"), size: "M", color: "den" }, ctx, db);
    expect(asked.variants).toEqual([expect.objectContaining({ size: "M", color: "đen", stock: 0 })]);

    const all = await getStock({ productId: id("VAY01") }, ctx, db);
    const seeded = demo.variants.filter((v) => v.code === "VAY01");
    expect(all.variants).toHaveLength(seeded.length);
    const inStock = all.variants.filter((v) => v.stock > 0).map((v) => `${v.size}/${v.color}`);
    expect(inStock).toEqual(expect.arrayContaining(["S/be", "M/be", "L/be", "S/đen"]));
    expect(inStock).not.toContain("M/đen");
  });

  it("every stock number get_stock returns equals the seed", async () => {
    for (const p of demo.products) {
      const out = await getStock({ productId: id(p.code) }, ctx, db);
      expect(out.price, p.name).toBe(p.price);
      const seeded = demo.variants.filter((v) => v.code === p.code);
      expect(out.variants, p.name).toHaveLength(seeded.length);
      for (const v of seeded) {
        expect(out.variants, `${p.name} ${v.size}/${v.color}`).toContainEqual(
          expect.objectContaining({ size: v.size, color: v.color, stock: v.stock }),
        );
      }
    }
  });
});
