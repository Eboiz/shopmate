import type { Db } from "../types";

// Two-shop fixture for integration tests (PB-03). Shop B has a product with the
// same name as shop A's but another price, so a leak between shops shows up as
// a wrong number. Ids are fixed RFC 4122 v4 uuids (version 4, variant 8).
const a = (n: string) => `a0000000-0000-4000-8000-0000000000${n}`;
const b = (n: string) => `b0000000-0000-4000-8000-0000000000${n}`;

export const FX = {
  a: {
    shop: a("01"),
    vay01: a("11"),
    ao03: a("12"),
    quan05: a("13"),
    vay01MBe: a("21"),
    vay01LBe: a("22"),
    vay01MDen: a("23"),
    ao03STrang: a("24"),
    ao03MTrang: a("25"),
    shopper: a("41"),
    conversation: a("31"),
  },
  b: {
    shop: b("01"),
    vay01: b("11"),
    vay01MBe: b("21"),
    shopper: b("41"),
    conversation: b("31"),
  },
} as const;

// The fixture deletes and recreates shops: never point it at a shared project.
export function assertLocalDb(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let host: string | undefined;
  try {
    host = url ? new URL(url).hostname : undefined;
  } catch {
    host = undefined;
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Integration tests only run against local Supabase");
  }
}

async function must(what: string, query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function cleanupTwoShops(db: Db): Promise<void> {
  assertLocalDb();
  // Deleting a shop cascades to everything it owns (orders and ai_turns included).
  await must("delete fixture shops", db.from("shops").delete().in("id", [FX.a.shop, FX.b.shop]));
}

// Idempotent: deletes both shops by id, then inserts them again.
export async function seedTwoShops(db: Db): Promise<void> {
  assertLocalDb();
  await cleanupTwoShops(db);
  const A = FX.a.shop;
  const B = FX.b.shop;

  await must(
    "shops",
    db.from("shops").insert([
      { id: A, name: "Shop A PB-03", slug: "shop-a-pb03" },
      { id: B, name: "Shop B PB-03", slug: "shop-b-pb03" },
    ]),
  );
  await must(
    "products",
    db.from("products").insert([
      { id: FX.a.vay01, shop_id: A, code: "VAY01", name: "Váy suông linen", category: "váy", price: 350000 },
      { id: FX.a.ao03, shop_id: A, code: "AO03", name: "Áo sơ mi trắng", category: "áo", price: 250000 },
      { id: FX.a.quan05, shop_id: A, code: "QUAN05", name: "Quần ống rộng", category: null, price: 300000 },
      { id: FX.b.vay01, shop_id: B, code: "VAY01", name: "Váy suông linen", category: "váy", price: 420000 },
    ]),
  );
  await must(
    "variants",
    db.from("variants").insert([
      { id: FX.a.vay01MBe, shop_id: A, product_id: FX.a.vay01, size: "M", color: "be", stock: 2 },
      { id: FX.a.vay01LBe, shop_id: A, product_id: FX.a.vay01, size: "L", color: "be", stock: 0 },
      { id: FX.a.vay01MDen, shop_id: A, product_id: FX.a.vay01, size: "M", color: "đen", stock: 5 },
      { id: FX.a.ao03STrang, shop_id: A, product_id: FX.a.ao03, size: "S", color: "trắng", stock: 3 },
      { id: FX.a.ao03MTrang, shop_id: A, product_id: FX.a.ao03, size: "M", color: "trắng", stock: 0 },
      { id: FX.b.vay01MBe, shop_id: B, product_id: FX.b.vay01, size: "M", color: "be", stock: 9 },
    ]),
  );
  const chart = (shop_id: string, product_id: string, size: string, h: [number, number], w: [number, number]) => ({
    shop_id,
    product_id,
    size,
    height_min_cm: h[0],
    height_max_cm: h[1],
    weight_min_kg: w[0],
    weight_max_kg: w[1],
  });
  await must(
    "size_charts",
    db.from("size_charts").insert([
      chart(A, FX.a.vay01, "S", [150, 157], [40, 46]),
      chart(A, FX.a.vay01, "M", [158, 164], [47, 53]),
      chart(A, FX.a.vay01, "L", [165, 172], [54, 60]),
      chart(B, FX.b.vay01, "M", [150, 180], [40, 80]),
    ]),
  );
  await must(
    "pairings",
    db.from("pairings").insert([
      { shop_id: A, product_a_id: FX.a.ao03, product_b_id: FX.a.vay01, reason: "Áo trắng hợp váy be" },
    ]),
  );
  await must(
    "policies",
    db.from("policies").insert([
      { shop_id: A, kind: "doi_tra", content: "Đổi trong 7 ngày" },
      { shop_id: A, kind: "giao_hang", content: "   " },
      { shop_id: B, kind: "doi_tra", content: "Shop B không đổi trả" },
    ]),
  );
  await must(
    "shoppers",
    db.from("shoppers").insert([
      { id: FX.a.shopper, shop_id: A, channel: "web", external_id: "pb03-shopper-a" },
      { id: FX.b.shopper, shop_id: B, channel: "web", external_id: "pb03-shopper-b" },
    ]),
  );
  await must(
    "conversations",
    db.from("conversations").insert([
      { id: FX.a.conversation, shop_id: A, shopper_id: FX.a.shopper, mode: "ai" },
      // Shop B stays in mode ai, so "B's mode didn't change" tests can fail.
      { id: FX.b.conversation, shop_id: B, shopper_id: FX.b.shopper, mode: "ai" },
    ]),
  );
}
