import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readDemoData, SHEET_COLUMNS, type SheetName } from "@/lib/seed/sheet";
import { matchingReply } from "../pairing-suggestions";
import { resolvePairings } from "./get-pairings";

const csv = Object.fromEntries(
  (Object.keys(SHEET_COLUMNS) as SheetName[]).map((sheet) => [
    sheet,
    readFileSync(path.join(process.cwd(), "supabase", "seed", "demo", `${sheet}.csv`), "utf8"),
  ]),
) as Record<SheetName, string>;
const parsed = readDemoData(csv);
if (!parsed.data) throw new Error(`Invalid PB-02 demo seed: ${parsed.errors.join("; ")}`);
const demo = parsed.data;
const codeToId = new Map(demo.products.map((product, index) => [
  product.code,
  `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
]));
const id = (code: string) => {
  const value = codeToId.get(code);
  if (!value) throw new Error(`Unknown demo product ${code}`);
  return value;
};
const rows = demo.pairings.map((pair) => ({ product_a_id: id(pair.a), product_b_id: id(pair.b), reason: pair.reason }));
const products = demo.products.map((product) => ({
  id: id(product.code), name: product.name, price: product.price, image_url: null,
}));
const variants = demo.variants.filter((variant) => variant.stock > 0).map((variant) => ({
  product_id: id(variant.code), size: variant.size,
}));

describe("PB-08 on the PB-02 demo seed", () => {
  it("checks 60 pairing directions and size scenarios without a wrong-stock or wrong-size suggestion", () => {
    expect(demo.pairings).toHaveLength(10);
    let scenarios = 0;
    for (const pair of demo.pairings) {
      for (const source of [pair.a, pair.b]) {
        const other = source === pair.a ? pair.b : pair.a;
        for (const size of [undefined, "S", "M"]) {
          scenarios += 1;
          const result = resolvePairings(id(source), size, rows, products, variants);
          const eligibleSizes = [...new Set(variants
            .filter((variant) => variant.product_id === id(other) && (size === undefined || variant.size === size))
            .map((variant) => variant.size))];
          expect(result.pairings.map((item) => item.productId)).toEqual(eligibleSizes.length ? [id(other)] : []);
          for (const item of result.pairings) {
            expect(item.reason).toBe(pair.reason);
            expect(item.sizesInStock.every((value) => eligibleSizes.includes(value))).toBe(true);
          }

          const cards = result.pairings.map((item) => ({
            productId: item.productId, name: item.name, price: item.price,
            imageUrl: item.imageUrl, sizesInStock: item.sizesInStock,
          }));
          const reply = matchingReply(result.pairings, cards);
          expect(reply.products.length).toBeLessThanOrEqual(2);
          expect(reply.products.map((item) => item.productId)).toEqual(result.pairings.map((item) => item.productId));
          if (reply.products.length > 0) expect(reply.text).toContain(pair.reason);
        }
      }
    }
    expect(scenarios).toBe(60);
  });

  it("returns no suggestion for a product with no declared pairing", () => {
    const unpaired = demo.products.find((product) => !demo.pairings.some((pair) => pair.a === product.code || pair.b === product.code));
    if (!unpaired) throw new Error("PB-02 seed needs one unpaired product");
    expect(resolvePairings(id(unpaired.code), undefined, rows, products, variants)).toEqual({ pairings: [] });
  });
});
