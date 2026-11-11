"use client";

import { useId, useState } from "react";
import { recommendSize } from "@/lib/engine/tools/size-recommendation";
import type { SizeChartRow } from "@/lib/shop/types";

type Props = {
  rows: SizeChartRow[];
  // Sizes of the chosen color that are in stock.
  availableSizes: string[];
  onPick: (size: string) => void;
  onAsk: (message: string) => void;
};

// The product's size chart and a height/weight finder. It runs the same
// function the AI uses (recommend_size), so both always give the same size.
export function SizeGuide({ rows, availableSizes, onPick, onAsk }: Props) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const id = useId();
  const heightCm = Number(height);
  const weightKg = Number(weight);
  const ready = height !== "" && weight !== "" && heightCm > 0 && weightKg > 0;
  const result = ready
    ? recommendSize(
        rows.map((row) => ({ size: row.size, height_min_cm: row.heightMinCm, height_max_cm: row.heightMaxCm, weight_min_kg: row.weightMinKg, weight_max_kg: row.weightMaxKg })),
        heightCm,
        weightKg,
      )
    : null;
  const hit = result?.status === "ok" ? result.size : null;
  const inStock = hit !== null && availableSizes.includes(hit);

  return (
    <section id="bang-size" aria-labelledby={`${id}-title`} className="mt-6 scroll-mt-24 rounded-xl border border-[#e3dfd8] bg-white p-5 sm:p-8">
      <h2 id={`${id}-title`} className="text-xl font-bold">Bảng size</h2>
      <p className="mt-2 text-sm text-[#706d67]">Nhập chiều cao và cân nặng để xem size hợp với bạn.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-semibold">
          Chiều cao (cm)
          <input type="number" inputMode="numeric" min={100} max={220} value={height} onChange={(event) => setHeight(event.target.value)} placeholder="158" className="ui-field min-h-11 w-32 px-3 text-base font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Cân nặng (kg)
          <input type="number" inputMode="numeric" min={25} max={150} value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="50" className="ui-field min-h-11 w-32 px-3 text-base font-normal" />
        </label>
      </div>
      <div aria-live="polite" className="mt-3 min-h-6 text-sm">
        {hit && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">Size {hit} hợp với bạn.</span>
            {inStock ? (
              <button type="button" onClick={() => onPick(hit)} className="min-h-11 font-semibold text-[#c2412b] underline-offset-4 hover:underline">Chọn size {hit}</button>
            ) : (
              <span className="text-[#706d67]">Màu đang chọn đã hết size {hit}.</span>
            )}
          </p>
        )}
        {result?.status === "out_of_range" && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Số đo nằm ngoài bảng size.</span>
            <button type="button" onClick={() => onAsk(`Mình cao ${heightCm}cm, nặng ${weightKg}kg thì mặc size nào vừa?`)} className="min-h-11 font-semibold text-[#c2412b] underline-offset-4 hover:underline">Hỏi shop tư vấn</button>
          </p>
        )}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#efebe4] text-left">
              <th scope="col" className="px-3 py-2.5 font-semibold">Size</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Chiều cao</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Cân nặng</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.size} className={`border-b border-[#e3dfd8] ${row.size === hit ? "bg-[#fff0eb] font-semibold" : ""}`}>
                <th scope="row" className="px-3 py-2.5 text-left font-semibold">{row.size}</th>
                <td className="px-3 py-2.5 tabular-nums">{row.heightMinCm}–{row.heightMaxCm} cm</td>
                <td className="px-3 py-2.5 tabular-nums">{row.weightMinKg}–{row.weightMaxKg} kg</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
