import { z } from "zod";

// PB-24: checks a size chart the owner typed in /admin/products. Used by the
// editor (instant feedback) and again by the server action. The database holds
// the same rules (supabase/migrations/20261112130000_pb24_size_chart_editor.sql).

// What the form holds: text as typed, so "abc" or an empty field gets a clear message.
export type SizeChartDraftRow = {
  size: string;
  heightMin: string;
  heightMax: string;
  weightMin: string;
  weightMax: string;
};

export type SizeChartRowValue = {
  size: string;
  heightMin: number;
  heightMax: number;
  weightMin: number;
  weightMax: number;
};

export const MAX_SIZE_ROWS = 10;
export const MAX_SIZE_LENGTH = 10;
// Above these a number is a typo (1600 for 160), not a customer.
export const MAX_HEIGHT_CM = 250;
export const MAX_WEIGHT_KG = 200;

export const EMPTY_SIZE_ROW: SizeChartDraftRow = { size: "", heightMin: "", heightMax: "", weightMin: "", weightMax: "" };

type Range = { label: string; unit: string; max: number; min: (r: SizeChartRowValue) => number; top: (r: SizeChartRowValue) => number };

const RANGES: Range[] = [
  { label: "chiều cao", unit: "cm", max: MAX_HEIGHT_CM, min: (r) => r.heightMin, top: (r) => r.heightMax },
  { label: "cân nặng", unit: "kg", max: MAX_WEIGHT_KG, min: (r) => r.weightMin, top: (r) => r.weightMax },
];

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,4}$/.test(trimmed) ? Number(trimmed) : null;
}

// Returns the chart as numbers, or the first problem in words the owner reads.
export function checkSizeChart(
  draft: SizeChartDraftRow[],
): { ok: true; rows: SizeChartRowValue[] } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (draft.length > MAX_SIZE_ROWS) return fail(`Bảng size tối đa ${MAX_SIZE_ROWS} dòng.`);

  const rows: SizeChartRowValue[] = [];
  for (const [index, row] of draft.entries()) {
    const line = `Dòng ${index + 1}`;
    const size = row.size.trim();
    if (!size) return fail(`${line}: hãy nhập tên size, ví dụ M.`);
    if (size.length > MAX_SIZE_LENGTH) return fail(`${line}: tên size tối đa ${MAX_SIZE_LENGTH} ký tự.`);
    const [heightMin, heightMax, weightMin, weightMax] = [row.heightMin, row.heightMax, row.weightMin, row.weightMax].map(wholeNumber);
    if (heightMin === null || heightMax === null) return fail(`Size ${size}: chiều cao phải là số nguyên (cm), ví dụ 155 đến 160.`);
    if (weightMin === null || weightMax === null) return fail(`Size ${size}: cân nặng phải là số nguyên (kg), ví dụ 45 đến 50.`);
    const value = { size, heightMin, heightMax, weightMin, weightMax };
    for (const range of RANGES) {
      const [lo, hi] = [range.min(value), range.top(value)];
      if (lo < 1 || hi > range.max) return fail(`Size ${size}: ${range.label} phải từ 1 đến ${range.max} ${range.unit}.`);
      if (lo > hi) return fail(`Size ${size}: ${range.label} "từ" (${lo}) lớn hơn "đến" (${hi}).`);
    }
    rows.push(value);
  }

  const seen = new Map<string, string>();
  for (const row of rows) {
    const key = row.size.toLowerCase();
    // The AI and the storefront match sizes exactly, so "M" and "m" would be two sizes.
    if (seen.has(key)) return fail(`Size ${row.size} bị lặp. Mỗi size chỉ một dòng.`);
    seen.set(key, row.size);
  }

  // Each height and each weight must point to one size (recommend_size, PB-06).
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [a, b] = [rows[i], rows[j]];
      for (const range of RANGES) {
        const [aMin, aMax, bMin, bMax] = [range.min(a), range.top(a), range.min(b), range.top(b)];
        if (aMin <= bMax && bMin <= aMax) {
          return fail(
            `Size ${a.size} và ${b.size} chồng khoảng ${range.label} (${aMin}–${aMax} và ${bMin}–${bMax} ${range.unit}). Mỗi ${range.label} chỉ được thuộc một size.`,
          );
        }
      }
    }
  }
  return { ok: true, rows };
}

const draftRowSchema = z.object({
  size: z.string(),
  heightMin: z.string(),
  heightMax: z.string(),
  weightMin: z.string(),
  weightMax: z.string(),
});

const BAD_FORM = "Dữ liệu bảng size không đọc được, hãy tải lại trang.";

// The editor posts the rows as JSON in one field next to productId.
export const saveSizeChartSchema = z
  .object({ productId: z.string().min(1), rows: z.string() })
  .transform((input, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rows);
    } catch {
      ctx.addIssue({ code: "custom", message: BAD_FORM });
      return z.NEVER;
    }
    const draft = z.array(draftRowSchema).safeParse(parsed);
    if (!draft.success) {
      ctx.addIssue({ code: "custom", message: BAD_FORM });
      return z.NEVER;
    }
    const checked = checkSizeChart(draft.data);
    if (!checked.ok) {
      ctx.addIssue({ code: "custom", message: checked.error });
      return z.NEVER;
    }
    return { productId: input.productId, rows: checked.rows };
  });
