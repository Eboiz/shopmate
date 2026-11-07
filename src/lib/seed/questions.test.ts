import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkTestQuestions } from "./questions";
import { readDemoData, SHEET_COLUMNS, type SheetName } from "./sheet";

const folder = new URL("../../../supabase/seed/demo/", import.meta.url);
const csv = Object.fromEntries((Object.keys(SHEET_COLUMNS) as SheetName[])
  .map((name) => [name, readFileSync(new URL(`${name}.csv`, folder), "utf8")])) as Record<SheetName, string>;
const parsed = readDemoData(csv);
if (!parsed.data) throw new Error(parsed.errors.join("\n"));
const original = parsed.data;
const questions = readFileSync(new URL("test_questions.csv", folder), "utf8");

describe("PB-28 PO question labels", () => {
  it("checks all 60 fixtures, including multi-turn measurements, reverse pairings and out-of-stock sizes", () => {
    expect(checkTestQuestions(original, questions)).toEqual([]);
  });

  it("reports the affected questions when catalog prices or shipping fees drift", () => {
    const changed = structuredClone(original);
    changed.products.find((p) => p.code === "VAY01")!.price += 10000;
    changed.policies.find((p) => p.kind === "giao_hang")!.content = "Phí ship đồng giá 20.000đ.";
    const errors = checkTestQuestions(changed, questions);
    for (const number of [2, 35, 39]) expect(errors.some((error) => error.includes(`câu ${number} `))).toBe(true);
  });

  it("catches an out-of-stock variant becoming available", () => {
    const changed = structuredClone(original);
    changed.variants.find((v) => v.code === "VAY01" && v.size === "L" && v.color === "đen")!.stock = 1;
    expect(checkTestQuestions(changed, questions).join("\n")).toContain("câu 6 ");
  });

  it("catches size chart drift and the removal of a declared pairing", () => {
    const changed = structuredClone(original);
    changed.sizeCharts.find((c) => c.code === "VAY01" && c.size === "M")!.weightMax = 49;
    changed.pairings = changed.pairings.filter((p) => p.a !== "AO03" && p.b !== "AO03");
    const errors = checkTestQuestions(changed, questions).join("\n");
    expect(errors).toContain("câu 1 ");
    expect(errors).toContain("câu 3 ");
  });

  it("checks the AO03 size M exception that suppresses pairing suggestions", () => {
    const changed = structuredClone(original);
    changed.variants.find((v) => v.code === "AO03" && v.size === "M")!.stock = 1;
    expect(checkTestQuestions(changed, questions).join("\n")).toContain("câu 27 ");
  });

  it("rejects additions that collide with protected search names", () => {
    const changed = structuredClone(original);
    changed.products.push({ ...changed.products[0], code: "VAY09", name: "Váy suông linen phiên bản mới" });
    expect(checkTestQuestions(changed, questions).join("\n")).toContain("products VAY09");
  });

  it("requires all 60 question rows and the expected columns", () => {
    expect(checkTestQuestions(original, questions.split("\n").slice(0, 60).join("\n")).join("\n")).toContain("cần 60 câu");
    expect(checkTestQuestions(original, questions.replace("size_dung", "size_sai"))).toContain("test_questions: thiếu cột size_dung");
  });
});
