// PB-46: the height and weight both size forms accept (the shop page's
// #tu-van-size and the product page's #bang-size), with one error message.
export const BODY_LIMITS = {
  heightCm: { min: 120, max: 210 },
  weightKg: { min: 30, max: 150 },
} as const;

const { heightCm: H, weightKg: W } = BODY_LIMITS;
export const BODY_LIMITS_ERROR = `Nhập chiều cao từ ${H.min} đến ${H.max} cm và cân nặng từ ${W.min} đến ${W.max} kg.`;

const inRange = (value: number, { min, max }: { min: number; max: number }) => Number.isFinite(value) && value >= min && value <= max;
// "158", "158,5", " 50 ": a comma counts as the decimal point. Empty is NaN.
const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.trim().replace(",", ".")));

// Both fields as numbers when both are inside BODY_LIMITS, otherwise null.
export function parseBody(height: string, weight: string): { heightCm: number; weightKg: number } | null {
  const heightCm = toNumber(height);
  const weightKg = toNumber(weight);
  return inRange(heightCm, H) && inRange(weightKg, W) ? { heightCm, weightKg } : null;
}
