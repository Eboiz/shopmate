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
  it("checks every pairing direction and size scenario without a wrong-stock or wrong-size suggestion", () => {
    expect(demo.pairings).toHaveLength(30);
    const eligibleSizes = (code: string, size: string | undefined) => [...new Set(variants
      .filter((variant) => variant.product_id === id(code) && (size === undefined || variant.size === size))
      .map((variant) => variant.size))];
    // A product may be in several pairs (SP27 goes with SP03 and SP31): all of them come back.
    const partners = (code: string) => demo.pairings
      .filter((pair) => pair.a === code || pair.b === code)
      .map((pair) => ({ code: pair.a === code ? pair.b : pair.a, reason: pair.reason }));
    let scenarios = 0;
    for (const pair of demo.pairings) {
      for (const source of [pair.a, pair.b]) {
        const other = source === pair.a ? pair.b : pair.a;
        for (const size of [undefined, "S", "M"]) {
          scenarios += 1;
          const result = resolvePairings(id(source), size, rows, products, variants);
          const expected = partners(source).filter((p) => eligibleSizes(p.code, size).length > 0);
          expect(result.pairings.map((item) => item.productId)).toEqual(expected.map((p) => id(p.code)));
          for (const item of result.pairings) {
            const partner = expected.find((p) => id(p.code) === item.productId)!;
            expect(item.reason).toBe(partner.reason);
            expect(item.sizesInStock.every((value) => eligibleSizes(partner.code, size).includes(value))).toBe(true);
          }
          const own = result.pairings.find((item) => item.productId === id(other));
          if (own) expect(own.reason).toBe(pair.reason);

          const cards = result.pairings.map((item) => ({
            productId: item.productId, name: item.name, price: item.price,
            imageUrl: item.imageUrl, sizesInStock: item.sizesInStock,
          }));
          const reply = matchingReply(result.pairings, cards);
          expect(reply.products.length).toBeLessThanOrEqual(2);
          // The reply keeps the first two suggestions, in the tool's order, with their reasons.
          const shown = result.pairings.slice(0, 2);
          expect(reply.products.map((item) => item.productId)).toEqual(shown.map((item) => item.productId));
          for (const item of shown) expect(reply.text).toContain(item.reason);
        }
      }
    }
    expect(scenarios).toBe(demo.pairings.length * 2 * 3);
  });

  it("returns no suggestion for a product with no declared pairing", () => {
    const unpaired = demo.products.find((product) => !demo.pairings.some((pair) => pair.a === product.code || pair.b === product.code));
    if (!unpaired) throw new Error("PB-02 seed needs one unpaired product");
    expect(resolvePairings(id(unpaired.code), undefined, rows, products, variants)).toEqual({ pairings: [] });
  });
});
