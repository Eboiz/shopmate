import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDemoData, SHEET_COLUMNS, type SheetName } from "./sheet";

// `pnpm db:seed --data=<name>` loads one of these folders into its own shop.
const read = (name: string) => {
  const folder = new URL(`../../../supabase/seed/${name}/`, import.meta.url);
  const csv = Object.fromEntries((Object.keys(SHEET_COLUMNS) as SheetName[])
    .map((sheet) => [sheet, readFileSync(new URL(`${sheet}.csv`, folder), "utf8")])) as Record<SheetName, string>;
  return { folder, ...readDemoData(csv, { expectCounts: name === "demo" }) };
};

describe("seed data sets", () => {
  const demo = read("demo");
  const may = read("may-boutique");

  it("reads the Mây Boutique data set without errors or warnings, with a photo per product", () => {
    expect(may.errors).toEqual([]);
    expect(may.warnings).toEqual([]);
    expect(may.data?.shop.slug).toBe("may-boutique");
    for (const p of may.data!.products) expect(existsSync(new URL(`images/${p.code}.jpg`, may.folder)), p.code).toBe(true);
  });

  it("keeps the two shops apart: different slugs and no shared product code (photos are stored by code)", () => {
    expect(demo.data?.shop.slug).toBe("hanh-boutique");
    const demoCodes = new Set(demo.data!.products.map((p) => p.code.toLowerCase()));
    expect(may.data!.products.filter((p) => demoCodes.has(p.code.toLowerCase())).map((p) => p.code)).toEqual([]);
  });
});
