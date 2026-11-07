// PB-06 (size recommendation) eval cases, on shop A of the two-shop fixture.
// Váy suông linen chart: S 150-157 cm / 40-46 kg, M 158-164 / 47-53,
// L 165-172 / 54-60. Áo sơ mi trắng has no size chart.
import type { HistoryMessage } from "@/contract";
import { fold } from "../text";
import { FX } from "../test/two-shops";
import type { EvalCase } from "./cases";

const V = FX.a.vay01;
const AO = FX.a.ao03;
const shopper = (text: string): HistoryMessage[] => [{ sender: "shopper", text }];
const saysSize = (size: string) => (text: string) => new RegExp(`(^|[^a-z0-9])${size.toLowerCase()}([^a-z0-9]|$)`).test(fold(text));
// Only this size is advised: no other letter size follows "size".
const advisesOnly = (size: string) => (text: string) =>
  saysSize(size)(text) && [...fold(text).matchAll(/\bsize\s*(xs|s|m|l|xl)\b/g)].every((m) => m[1] === size.toLowerCase());
const sizeAt = (heightCm: number, weightKg: number, productId = V) => ({
  tool: "recommend_size" as const,
  args: { productId, heightCm, weightKg },
  required: true,
});
const stockMaybe = { tool: "get_stock" as const, args: { productId: V }, required: false };

export const pb06Cases: EvalCase[] = [
  {
    id: "size-demo-m",
    description: "PB-06 demo question: 158 cm / 50 kg on Váy suông linen is M.",
    history: shopper("Mình cao 158cm nặng 50kg thì mặc váy này size gì?"),
    productId: V,
    expected: [sizeAt(158, 50), stockMaybe],
    handoff: null,
    reply: { label: "advises M only", ok: advisesOnly("M") },
  },
  {
    id: "size-phrase-cao-1m6",
    description: "PB-06 AC2: 'cao 1m6 nặng 50' reaches recommend_size as 160 / 50 (M).",
    history: shopper("cao 1m6 nặng 50 mặc size nào vừa shop"),
    productId: V,
    expected: [sizeAt(160, 50), stockMaybe],
    reply: { label: "advises M", ok: advisesOnly("M") },
  },
  {
    id: "size-phrase-weight-first",
    description: "PB-06 AC2: weight before height, '50kg 160cm' is 160 / 50 (M).",
    history: shopper("50kg 160cm mặc size gì ạ"),
    productId: V,
    expected: [sizeAt(160, 50), stockMaybe],
    reply: { label: "advises M", ok: advisesOnly("M") },
  },
  {
    id: "size-phrase-1-65m",
    description: "PB-06 AC2: '1.65m' and '55kg' are 165 / 55 (L).",
    history: shopper("Mình 1.65m 55kg thì lấy size nào?"),
    productId: V,
    expected: [sizeAt(165, 55), stockMaybe],
    reply: { label: "advises L", ok: advisesOnly("L") },
  },
  {
    id: "size-out-of-range",
    description: "PB-06 AC4: 180 cm / 75 kg is past the chart; say so and hand off.",
    history: shopper("Mình cao 1m80 nặng 75kg mặc váy này size nào?"),
    productId: V,
    expected: [sizeAt(180, 75), { tool: "handoff_to_staff", args: { reason: "size_out_of_range" }, required: false }],
    handoff: "size_out_of_range",
    reply: { label: "says outside the size chart", ok: (t) => fold(t).includes("ngoai bang size") },
  },
  {
    id: "size-no-chart",
    description: "PB-06 AC4: the shirt has no size chart; say so and hand off.",
    history: shopper("Mình cao 1m60 nặng 50kg mặc áo sơ mi này size gì?"),
    productId: AO,
    expected: [
      sizeAt(160, 50, AO),
      { tool: "get_stock", args: { productId: AO }, required: false },
      { tool: "handoff_to_staff", args: { reason: "not_covered_by_data" }, required: false },
    ],
    handoff: "not_covered_by_data",
    reply: { label: "says no size chart", ok: (t) => fold(t).includes("chua co bang size") },
  },
];
