// Reads and checks the demo shop sheets (PB-02 format, one CSV per sheet) before
// the seed writes anything. Every rule the database would reject halfway
// through, plus the data rules of the sheet format, is reported here by sheet,
// row and column.
//
// Imports are relative with a .ts extension because `scripts/seed.ts` runs this
// file with plain Node, which knows neither the `@/` alias nor extensionless paths.
import { Constants } from "../../contract/database.types.ts";
import type { PolicyKind } from "../../contract/enums.ts";

export const SHEET_COLUMNS = {
  shop: ["ten_shop", "slug"],
  products: ["ma_sp", "ten", "loai", "gia", "mo_ta", "anh"],
  variants: ["ma_sp", "size", "mau", "ton_kho"],
  size_charts: ["ma_sp", "size", "cao_tu_cm", "cao_den_cm", "nang_tu_kg", "nang_den_kg"],
  pairings: ["ma_sp_1", "ma_sp_2", "ly_do"],
  policies: ["loai", "noi_dung"],
} as const;

export type SheetName = keyof typeof SHEET_COLUMNS;

export type DemoData = {
  shop: { name: string; slug: string };
  products: { code: string; name: string; category: string | null; price: number; description: string | null }[];
  variants: { code: string; size: string; color: string; stock: number }[];
  sizeCharts: {
    code: string; size: string; heightMin: number; heightMax: number; weightMin: number; weightMax: number;
  }[];
  pairings: { a: string; b: string; reason: string }[];
  policies: { kind: PolicyKind; content: string }[];
};

const EXPECTED_PRODUCTS = 60;
const EXPECTED_PAIRINGS = 20;
const MAX_INT = 2147483647;
const POLICY_KINDS: readonly string[] = Constants.public.Enums.policy_kind;

/**
 * RFC 4180 CSV: quoted cells may hold commas, quotes ("") and newlines. Rows whose
 * cells are all empty are skipped. `line` is the line of the file the record starts
 * on, so error messages point where the PO looks. Throws on a quote that is never closed.
 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let quoteLine = 0;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c !== "")) rows.push({ line: start, cells });
    cells = []; cell = "";
  };
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"') { quoted = true; quoteLine = line; }
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      endRow();
      start = ++line;
    } else cell += ch;
  }
  if (quoted) throw new Error(`ngoặc kép mở ở dòng ${quoteLine} không được đóng`);
  endRow();
  return rows;
}

const clean = (s: string | undefined) => (s ?? "").normalize("NFC").trim();
const key = (...parts: string[]) => parts.map((p) => p.toLowerCase()).join("\u0000");

type Row = { line: number; get: (column: string) => string };

// `expectCounts` warns when the PO's target counts are not met; other data sets turn it off.
export function readDemoData(csv: Record<SheetName, string>, { expectCounts = true } = {}): {
  data: DemoData | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Header check first: with a missing column every later message would be noise.
  const tables = {} as Record<SheetName, Row[]>;
  for (const sheet of Object.keys(SHEET_COLUMNS) as SheetName[]) {
    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(csv[sheet]);
    } catch (e) {
      errors.push(`${sheet}: ${(e as Error).message}`);
      continue;
    }
    const [header, ...body] = parsed;
    const index = new Map((header?.cells ?? []).map((h, i) => [clean(h), i]));
    for (const column of SHEET_COLUMNS[sheet]) {
      if (!index.has(column)) errors.push(`${sheet}: thiếu cột ${column}`);
    }
    tables[sheet] = body.map(({ line, cells }) => ({ line, get: (c) => clean(cells[index.get(c) ?? -1]) }));
  }
  if (errors.length > 0) return { data: null, errors, warnings };

  // Cell readers: each pushes its own error and returns null on a bad value.
  const at = (sheet: SheetName, row: Row, column: string) => `${sheet} dòng ${row.line}, cột ${column}`;
  const bad = (message: string) => {
    errors.push(message);
    return null;
  };
  const required = (sheet: SheetName, row: Row, column: string) => {
    const value = row.get(column);
    return value !== "" ? value : bad(`${at(sheet, row, column)}: không được để trống`);
  };
  // A whole number written as digits only. `positive` also rejects 0; `max` is inclusive.
  const integer = (
    sheet: SheetName, row: Row, column: string, notDigits: string,
    { positive = false, max = MAX_INT, tooBig = "quá lớn" } = {},
  ) => {
    const value = row.get(column);
    if (!/^\d+$/.test(value)) return bad(`${at(sheet, row, column)}: ${notDigits}`);
    const n = Number(value);
    if (n > max) return bad(`${at(sheet, row, column)}: ${tooBig}`);
    if (positive && n === 0) return bad(`${at(sheet, row, column)}: phải lớn hơn 0`);
    return n;
  };
  const firstSeen = new Map<string, number>();
  const unique = (scope: string, k: string, line: number, message: string) => {
    const id = `${scope}\u0001${k}`;
    const seen = firstSeen.get(id);
    if (seen !== undefined) {
      errors.push(`${message} trùng dòng ${seen}`);
      return false;
    }
    firstSeen.set(id, line);
    return true;
  };

  // shop
  if (tables.shop.length !== 1) errors.push(`shop: cần đúng 1 dòng, có ${tables.shop.length}`);
  let shop: DemoData["shop"] | null = null;
  const shopRow = tables.shop[0];
  if (shopRow) {
    const name = required("shop", shopRow, "ten_shop");
    const slug = required("shop", shopRow, "slug");
    if (slug !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      errors.push(`${at("shop", shopRow, "slug")}: chỉ gồm chữ thường không dấu, số và dấu gạch ngang`);
    } else if (name !== null && slug !== null) shop = { name, slug };
  }

  // products
  const products: DemoData["products"] = [];
  const codes = new Map<string, string>(); // lower-case code -> code as written
  for (const row of tables.products) {
    const code = required("products", row, "ma_sp");
    const name = required("products", row, "ten");
    const price = integer("products", row, "gia", "phải là số nguyên đồng", {
      positive: true, max: 99999999, tooBig: "phải nhỏ hơn 100000000",
    });
    if (code === null || !unique("products", key(code), row.line, `products dòng ${row.line}: ma_sp ${code}`)) continue;
    codes.set(code.toLowerCase(), code);
    if (name === null || price === null) continue;
    products.push({
      code, name, price,
      category: row.get("loai") || null,
      description: row.get("mo_ta") || null,
    });
  }
  const productCode = (sheet: SheetName, row: Row, column: string) => {
    const code = required(sheet, row, column);
    if (code === null) return null;
    const known = codes.get(code.toLowerCase());
    if (!known) errors.push(`${sheet} dòng ${row.line}: ${column} ${code} không có trong products`);
    return known ?? null;
  };

  // variants
  const variants: DemoData["variants"] = [];
  const spelling = new Map<string, { value: string; line: number }>();
  for (const row of tables.variants) {
    const code = productCode("variants", row, "ma_sp");
    const size = required("variants", row, "size");
    const color = required("variants", row, "mau");
    const stock = integer("variants", row, "ton_kho", "phải là số nguyên từ 0 trở lên");
    if (code === null || size === null || color === null || stock === null) continue;
    // The database stores sizes and colors as written and tools match them exactly,
    // so "M" and "m" of one product would become two sizes.
    const respelled = ([["size", size], ["màu", color]] as const).filter(([what, value]) => {
      const first = spelling.get(key(code, what, value));
      if (!first) spelling.set(key(code, what, value), { value, line: row.line });
      else if (first.value !== value) {
        errors.push(`variants dòng ${row.line}: ${code} ${what} ${value} viết khác dòng ${first.line} (${first.value})`);
        return true;
      }
      return false;
    });
    if (respelled.length > 0) continue;
    const message = `variants dòng ${row.line}: ${code} size ${size} màu ${color}`;
    if (unique("variants", key(code, size, color), row.line, message)) variants.push({ code, size, color, stock });
  }
  const sizesOf = new Map<string, string[]>();
  for (const code of codes.values()) {
    const own = variants.filter((v) => v.code === code);
    const sizes = [...new Map(own.map((v) => [v.size.toLowerCase(), v.size])).values()];
    const colors = [...new Map(own.map((v) => [v.color.toLowerCase(), v.color])).values()];
    sizesOf.set(code, sizes);
    if (sizes.length < 3 || sizes.length > 5) errors.push(`variants: ${code} có ${sizes.length} size, cần 3 đến 5`);
    if (colors.length < 2 || colors.length > 3) errors.push(`variants: ${code} có ${colors.length} màu, cần 2 đến 3`);
    const have = new Set(own.map((v) => key(v.size, v.color)));
    for (const size of sizes) for (const color of colors) {
      if (!have.has(key(size, color))) errors.push(`variants: ${code} thiếu dòng size ${size} màu ${color}`);
    }
  }

  // size_charts
  const sizeCharts: DemoData["sizeCharts"] = [];
  for (const row of tables.size_charts) {
    const code = productCode("size_charts", row, "ma_sp");
    const size = required("size_charts", row, "size");
    const range = (min: string, max: string) => {
      const lo = integer("size_charts", row, min, "phải là số nguyên", { positive: true });
      const hi = integer("size_charts", row, max, "phải là số nguyên", { positive: true });
      if (lo === null || hi === null) return null;
      if (lo > hi) return bad(`size_charts dòng ${row.line}: ${min} ${lo} lớn hơn ${max} ${hi}`);
      return { lo, hi };
    };
    const height = range("cao_tu_cm", "cao_den_cm");
    const weight = range("nang_tu_kg", "nang_den_kg");
    if (code === null || size === null || height === null || weight === null) continue;
    if (!unique("size_charts", key(code, size), row.line, `size_charts dòng ${row.line}: ${code} size ${size}`)) continue;
    sizeCharts.push({
      code, size, heightMin: height.lo, heightMax: height.hi, weightMin: weight.lo, weightMax: weight.hi,
    });
  }
  for (const [code, sold] of sizesOf) {
    const charted = sizeCharts.filter((c) => c.code === code);
    for (const c of charted) {
      if (!sold.includes(c.size)) {
        errors.push(`size_charts: ${code} có size ${c.size} không bán (variants: ${sold.join(", ")})`);
      }
    }
    for (const size of sold) {
      if (!charted.some((c) => c.size === size)) errors.push(`size_charts: ${code} thiếu size ${size}`);
    }
    // PB-06: height and weight each point to one size, so neither range may overlap
    // another size's range of the same product. Bounds are inclusive.
    for (let i = 0; i < charted.length; i++) for (let j = i + 1; j < charted.length; j++) {
      const [a, b] = [charted[i], charted[j]];
      const dims = [
        ["chiều cao", "cm", a.heightMin, a.heightMax, b.heightMin, b.heightMax],
        ["cân nặng", "kg", a.weightMin, a.weightMax, b.weightMin, b.weightMax],
      ] as const;
      for (const [label, unit, aMin, aMax, bMin, bMax] of dims) {
        if (aMin <= bMax && bMin <= aMax) {
          errors.push(
            `size_charts: ${code} size ${a.size} và ${b.size} chồng khoảng ${label} (${aMin}–${aMax} và ${bMin}–${bMax} ${unit})`,
          );
        }
      }
    }
  }

  // pairings: one row works both ways (PB-08, A8), so A–B and B–A are the same pair.
  const pairings: DemoData["pairings"] = [];
  for (const row of tables.pairings) {
    const a = productCode("pairings", row, "ma_sp_1");
    const b = productCode("pairings", row, "ma_sp_2");
    const reason = required("pairings", row, "ly_do");
    if (a === null || b === null || reason === null) continue;
    if (a === b) {
      errors.push(`pairings dòng ${row.line}: một sản phẩm không ghép với chính nó`);
      continue;
    }
    const pair = key(...[a, b].sort());
    if (unique("pairings", pair, row.line, `pairings dòng ${row.line}: cặp ${a}–${b}`)) pairings.push({ a, b, reason });
  }

  // policies: one row per kind; empty content means "no such policy, hand off".
  const policies: DemoData["policies"] = [];
  for (const row of tables.policies) {
    const kind = row.get("loai");
    if (!POLICY_KINDS.includes(kind)) {
      errors.push(`${at("policies", row, "loai")}: phải là ${POLICY_KINDS.slice(0, -1).join(", ")} hoặc ${POLICY_KINDS.at(-1)}`);
      continue;
    }
    if (unique("policies", kind, row.line, `policies dòng ${row.line}: loai ${kind}`)) {
      policies.push({ kind: kind as PolicyKind, content: row.get("noi_dung") });
    }
  }
  for (const kind of POLICY_KINDS) {
    if (!policies.some((p) => p.kind === kind)) errors.push(`policies: thiếu dòng ${kind}`);
  }

  if (expectCounts && codes.size !== EXPECTED_PRODUCTS) warnings.push(`products: ${codes.size} sản phẩm, issue yêu cầu ${EXPECTED_PRODUCTS}`);
  if (expectCounts && tables.pairings.length !== EXPECTED_PAIRINGS) {
    warnings.push(`pairings: ${tables.pairings.length} cặp, issue yêu cầu ${EXPECTED_PAIRINGS}`);
  }

  if (errors.length > 0 || shop === null) return { data: null, errors, warnings };
  return { data: { shop, products, variants, sizeCharts, pairings, policies }, errors, warnings };
}
