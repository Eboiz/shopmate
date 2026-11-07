// PB-06: height and weight as Vietnamese shoppers write them, turned into the
// whole centimetres / kilograms recommend_size takes. Deterministic: the model
// may convert "1m65" itself, but the engine re-reads the shopper's own words so a
// wrong conversion never reaches the size function.
import type { HistoryMessage } from "@/contract";
import { fold } from "./text";

// Halves and other decimals round UP: a shopper between two whole numbers gets
// the larger size, the same rule as recommendSize (and A1).
const toWhole = (n: number) => Math.ceil(n - 1e-9);
const num = (s: string) => Number(s.replace(",", "."));

const HEIGHT_RANGE = [50, 250] as const; // recommend_size input bounds (PB-00)
const WEIGHT_RANGE = [20, 250] as const;
const inRange = (n: number, [lo, hi]: readonly [number, number]) => (n >= lo && n <= hi ? n : null);

// "1m65", "1m6", "1.65m", "1,65", "165cm", "165 cm", "165" -> 165. A plain number
// under 3 is metres. Returns null for anything else or out of 50-250 cm.
export function parseHeightCm(raw: string | number): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return inRange(toWhole(raw < 3 ? raw * 100 : raw), HEIGHT_RANGE);
  }
  const s = fold(raw).replace(/\s+/g, "");
  let m = /^(\d)m(\d{1,2})?$/.exec(s);
  if (m) return inRange(Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0), HEIGHT_RANGE);
  m = /^(\d[.,]\d{1,2})m?$/.exec(s);
  if (m) return inRange(toWhole(num(m[1]) * 100), HEIGHT_RANGE);
  m = /^(\d{2,3}(?:[.,]\d+)?)(?:cm)?$/.exec(s);
  if (m) return inRange(toWhole(num(m[1])), HEIGHT_RANGE);
  return null;
}

// "58kg", "58 kg", "58 ký", "58 kí", "58 cân", "58 kilo", "58" -> 58.
export function parseWeightKg(raw: string | number): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? inRange(toWhole(raw), WEIGHT_RANGE) : null;
  const s = fold(raw).replace(/\s+/g, "");
  const m = /^(\d{2,3}(?:[.,]\d+)?)(?:kg|kgs|kilo|kilogam|ky|ki|can)?$/.exec(s);
  return m ? inRange(toWhole(num(m[1])), WEIGHT_RANGE) : null;
}

// Height and weight found in one free-text message. Only written forms that
// cannot be something else count: a unit ("1m65", "165cm", "58kg", "58 ký",
// "58 cân") or a keyword before the number ("cao 165", "nặng 58"). A bare number
// in a sentence (a price, a size like 28) is ignored. The last mention wins.
export function extractMeasurements(text: string): { heightCm: number | null; weightKg: number | null } {
  const s = fold(text);
  const find = (patterns: RegExp[], parse: (x: string) => number | null) => {
    const hits: { index: number; v: number }[] = [];
    for (const re of patterns) {
      for (const m of s.matchAll(re)) {
        const v = parse(m[1]);
        if (v !== null) hits.push({ index: m.index, v });
      }
    }
    return hits.sort((a, b) => a.index - b.index).at(-1)?.v ?? null;
  };
  return {
    heightCm: find(
      [
        /(?<![\d.,])(1\s?m\s?\d{1,2})(?![\d]|[.,]\d)/g, // 1m65, 1m6
        /(?<![\d.,])(\d[.,]\d{1,2})\s?m\b/g, // 1.65m, 1,65m
        /(?<![\d.,])(\d{2,3}(?:[.,]\d+)?)\s?cm\b/g, // 165cm, 165 cm
        /\bcao\s*(?:khoang|tam|co|la|:)?\s*(\d{3}(?:[.,]\d+)?|\d[.,]\d{1,2})(?!\d|[.,]\d)/g, // cao 165, cao 1.65
      ],
      parseHeightCm,
    ),
    weightKg: find(
      [
        /(?<![\d.,])(\d{2,3}(?:[.,]\d+)?)\s?(?:kg|kgs|kilo|ky|ki|can)\b/g, // 58kg, 58 ký, 58 kí, 58 cân
        /\bnang\s*(?:khoang|tam|co|la|:)?\s*(\d{2,3}(?:[.,]\d+)?)(?!\d|[.,]\d)/g, // nặng 58
      ],
      parseWeightKg,
    ),
  };
}

// The most recent height and weight the shopper wrote, each from the newest
// shopper message that has it.
export function shopperMeasurements(history: HistoryMessage[]): { heightCm: number | null; weightKg: number | null } {
  let heightCm: number | null = null;
  let weightKg: number | null = null;
  for (let i = history.length - 1; i >= 0 && (heightCm === null || weightKg === null); i--) {
    if (history[i].sender !== "shopper") continue;
    const found = extractMeasurements(history[i].text);
    heightCm ??= found.heightCm;
    weightKg ??= found.weightKg;
  }
  return { heightCm, weightKg };
}

// The input that reaches recommend_size: what the shopper wrote wins over the
// model's numbers; otherwise the model's value is parsed ("1m65", 1.65, "58kg").
// Anything unparseable is left as it is, so the tool's Zod schema rejects it.
export function normalizeSizeInput(input: unknown, history: HistoryMessage[]): unknown {
  if (!input || typeof input !== "object") return input;
  const raw = input as Record<string, unknown>;
  const said = shopperMeasurements(history);
  const fromModel = (v: unknown, parse: (x: string | number) => number | null) =>
    typeof v === "string" || typeof v === "number" ? parse(v) : null;
  const heightCm = said.heightCm ?? fromModel(raw.heightCm, parseHeightCm) ?? raw.heightCm;
  const weightKg = said.weightKg ?? fromModel(raw.weightKg, parseWeightKg) ?? raw.weightKg;
  return { ...raw, heightCm, weightKg };
}
