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

// "1m65", "1m6", "1 mét 65", "m65", "1.65m", "1,65", "165cm", "165 cm", "165" -> 165.
// A plain number under 3 is metres; "m6" / "m65" is slang for 1m6 / 1m65.
// Returns null for anything else or out of 50-250 cm.
export function parseHeightCm(raw: string | number): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return inRange(toWhole(raw < 3 ? raw * 100 : raw), HEIGHT_RANGE);
  }
  const s = fold(raw).replace(/\s+/g, "").replace(/^(\d?)met/, "$1m").replace(/^m(?=\d)/, "1m");
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
// in a sentence (a price, a size like 28) is ignored, except a message whose only
// two numbers are a plausible height and weight ("160 50", "50 160"). The last
// mention wins.
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
  const found = {
    heightCm: find(
      [
        /(?<![\d.,])(1\s?(?:m|met)\s?\d{1,2})(?![\d]|[.,]\d)/g, // 1m65, 1m6, 1 mét 65
        /(?<![\d.,])(\d[.,]\d{1,2})\s?m\b/g, // 1.65m, 1,65m
        /(?<![\d.,])(\d{2,3}(?:[.,]\d+)?)\s?cm\b/g, // 165cm, 165 cm
        /\bcao\s*(?:khoang|tam|co|la|:)?\s*(\d{3}(?:[.,]\d+)?|\d[.,]\d{1,2}|m\d{1,2})(?!\d|[.,]\d)/g, // cao 165, cao 1.65, cao m6
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
  return found.heightCm === null && found.weightKg === null ? barePair(s) ?? found : found;
}

// "160 50" / "50 160": exactly two numbers in the message, both plain integers
// (no unit, no "k", no decimals), one a plausible adult height and the other a
// plausible weight. The ranges don't overlap, so the order doesn't matter.
const BARE_HEIGHT = [130, 200] as const;
const BARE_WEIGHT = [30, 120] as const;
function barePair(folded: string): { heightCm: number; weightKg: number } | null {
  const tokens = [...folded.matchAll(/\d+(?:[.,]\d+)*[a-z%]*/g)].map((m) => m[0]);
  if (tokens.length !== 2 || !tokens.every((t) => /^\d{2,3}$/.test(t))) return null;
  const [x, y] = tokens.map(Number);
  for (const [h, w] of [[x, y], [y, x]]) {
    if (inRange(h, BARE_HEIGHT) !== null && inRange(w, BARE_WEIGHT) !== null) return { heightCm: h, weightKg: w };
  }
  return null;
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
