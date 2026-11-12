"use client";

import { useActionState, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import type { CatalogSizeRow } from "@/lib/catalog";
import {
  checkSizeChart,
  EMPTY_SIZE_ROW,
  MAX_SIZE_LENGTH,
  MAX_SIZE_ROWS,
  type SizeChartDraftRow,
} from "@/lib/size-chart-validation";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type SizeChartProduct = {
  id: string;
  code: string;
  name: string;
  // Sizes the product is sold in (its variants), to suggest and to spot gaps.
  sizes: string[];
  sizeChart: CatalogSizeRow[];
};

type SizeChartEditorProps = {
  product: SizeChartProduct;
  canEdit: boolean;
  saveSizeChart: FormAction;
};

const toDraft = (row: CatalogSizeRow): SizeChartDraftRow => ({
  size: row.size,
  heightMin: String(row.heightMin),
  heightMax: String(row.heightMax),
  weightMin: String(row.weightMin),
  weightMax: String(row.weightMax),
});

// Compares what the owner typed with what is saved, ignoring stray spaces.
const fingerprint = (rows: SizeChartDraftRow[]) =>
  JSON.stringify(rows.map((row) => Object.values(row).map((value) => value.trim())));

// PB-24: one product's size chart, folded so 60 products stay scannable.
export function SizeChartCard(props: SizeChartEditorProps) {
  const { product } = props;
  const missing = product.sizes.filter(
    (size) => !product.sizeChart.some((row) => row.size.toLowerCase() === size.toLowerCase()),
  );

  return (
    <details className="ui-card group overflow-hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-[#faf8f5] sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{product.name}</span>
          <span className="block text-xs text-[#706d67]">{product.code}</span>
        </span>
        {product.sizeChart.length === 0 ? (
          <span className="shrink-0 rounded-full bg-[#fff0eb] px-2.5 py-1 text-xs font-semibold text-[#a83826]">Chưa có bảng size</span>
        ) : missing.length > 0 ? (
          <span className="shrink-0 rounded-full bg-[#fff6e0] px-2.5 py-1 text-xs font-semibold text-[#8a5a00]">Thiếu size {missing.join(", ")}</span>
        ) : (
          <span className="shrink-0 text-xs text-[#706d67]">{product.sizeChart.length} size</span>
        )}
        <Icon name="chevron" className="size-4 shrink-0 text-[#706d67] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[#e3dfd8] px-5 py-4 sm:px-6">
        {props.canEdit ? <SizeChartForm {...props} /> : <SizeChartTable rows={product.sizeChart} />}
      </div>
    </details>
  );
}

function SizeChartTable({ rows }: { rows: CatalogSizeRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[#706d67]">Món này chưa có bảng size. Khách hỏi size sẽ được chuyển cho nhân viên.</p>;
  }
  return (
    <table className="w-full text-left text-sm tabular-nums">
      <thead className="text-xs text-[#706d67]">
        <tr>
          <th scope="col" className="py-2 pr-3 font-medium">Size</th>
          <th scope="col" className="py-2 pr-3 font-medium">Chiều cao (cm)</th>
          <th scope="col" className="py-2 font-medium">Cân nặng (kg)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.size} className="border-t border-[#efebe4]">
            <th scope="row" className="py-2 pr-3 font-semibold">{row.size}</th>
            <td className="py-2 pr-3">{row.heightMin}–{row.heightMax}</td>
            <td className="py-2">{row.weightMin}–{row.weightMax}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SizeChartForm({ product, saveSizeChart }: SizeChartEditorProps) {
  const [state, formAction, pending] = useActionState(saveSizeChart, INITIAL_FORM_STATE);
  const [rows, setRows] = useState<SizeChartDraftRow[]>(() => product.sizeChart.map(toDraft));
  const [checkError, setCheckError] = useState<string | null>(null);
  const listId = useId();
  const errorId = useId();

  const dirty = fingerprint(rows) !== fingerprint(product.sizeChart.map(toDraft));
  const error = checkError ?? (dirty ? state.error : null);
  const saved = state !== INITIAL_FORM_STATE && state.error === null && !dirty && !pending;
  const missing = product.sizes.filter(
    (size) => !rows.some((row) => row.size.trim().toLowerCase() === size.toLowerCase()),
  );

  function edit(index: number, field: keyof SizeChartDraftRow, value: string) {
    setCheckError(null);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setCheckError(null);
    setRows((current) => [...current, { ...EMPTY_SIZE_ROW, size: missing[0] ?? "" }]);
  }

  function removeRow(index: number) {
    setCheckError(null);
    setRows((current) => current.filter((_, i) => i !== index));
  }

  // Same rules as the server: show the problem now instead of after a round trip.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const checked = checkSizeChart(rows);
    if (!checked.ok) {
      event.preventDefault();
      setCheckError(checked.error);
    }
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby={error ? errorId : undefined}>
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <datalist id={listId}>
        {product.sizes.map((size) => <option key={size} value={size} />)}
      </datalist>

      {rows.length === 0 ? (
        <p className="text-sm leading-6 text-[#706d67]">Chưa có dòng nào. Khi bảng size trống, khách hỏi size món này sẽ được chuyển cho nhân viên.</p>
      ) : (
        <div>
          <div aria-hidden="true" className="hidden grid-cols-[5rem_1fr_1fr_2.75rem] gap-3 pb-2 text-xs font-medium text-[#706d67] sm:grid">
            <span>Size</span>
            <span>Chiều cao (cm)</span>
            <span>Cân nặng (kg)</span>
          </div>
          <ul className="flex flex-col divide-y divide-[#efebe4] sm:divide-y-0" aria-label={`Bảng size ${product.name}`}>
            {rows.map((row, index) => {
              const name = row.size.trim() || `dòng ${index + 1}`;
              return (
                <li key={index} className="grid grid-cols-[1fr_2.75rem] items-center gap-x-3 gap-y-2 py-3 first:pt-0 sm:grid-cols-[5rem_1fr_1fr_2.75rem] sm:py-1.5">
                  <input
                    aria-label={`Tên size, dòng ${index + 1}`}
                    list={listId}
                    value={row.size}
                    maxLength={MAX_SIZE_LENGTH}
                    placeholder="M"
                    onChange={(event) => edit(index, "size", event.target.value)}
                    className="ui-field min-h-11 w-full min-w-0 px-3 text-base font-semibold sm:w-20"
                  />
                  <RangeInputs
                    caption="Cao (cm)"
                    label={`Chiều cao size ${name}`}
                    from={row.heightMin}
                    to={row.heightMax}
                    onFrom={(value) => edit(index, "heightMin", value)}
                    onTo={(value) => edit(index, "heightMax", value)}
                  />
                  <RangeInputs
                    caption="Nặng (kg)"
                    label={`Cân nặng size ${name}`}
                    from={row.weightMin}
                    to={row.weightMax}
                    onFrom={(value) => edit(index, "weightMin", value)}
                    onTo={(value) => edit(index, "weightMax", value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label={`Bỏ dòng size ${name}`}
                    title="Bỏ dòng"
                    className="col-start-2 row-start-1 inline-grid size-11 place-items-center rounded-lg text-[#706d67] transition-colors hover:bg-[#fff0eb] hover:text-[#b2382a] sm:col-start-auto sm:row-start-auto"
                  >
                    <Icon name="trash" className="size-5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {missing.length > 0 && rows.length > 0 && (
        <p className="text-xs leading-5 text-[#8a5a00]">Shop đang bán size {missing.join(", ")} nhưng bảng chưa có dòng cho size đó.</p>
      )}
      <p className="text-xs leading-5 text-[#706d67]">Khoảng tính cả hai đầu. Hai size không được chung một số đo, ví dụ S 150–155 thì M bắt đầu từ 156.</p>
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
      {saved && <p role="status" className="text-sm text-[#2f6b3a]">Đã lưu. AI dùng bảng size mới từ câu hỏi tiếp theo.</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={addRow} disabled={rows.length >= MAX_SIZE_ROWS || pending}>
          + Thêm dòng
        </Button>
        <div className="flex items-center gap-3">
          {dirty && !pending && <span className="text-xs text-[#706d67]">Chưa lưu</span>}
          <Button type="submit" loading={pending} loadingText="Đang lưu…" disabled={!dirty}>
            Lưu bảng size
          </Button>
        </div>
      </div>
    </form>
  );
}

function RangeInputs({
  caption,
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  caption: string;
  label: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  const field = "ui-field min-h-11 w-full min-w-0 px-2 text-center text-base tabular-nums";
  return (
    <div role="group" aria-label={label} className="col-span-2 flex flex-col gap-1 sm:col-span-1">
      <span aria-hidden="true" className="text-xs text-[#706d67] sm:hidden">{caption}</span>
      <div className="flex items-center gap-1.5">
        <input aria-label="từ" inputMode="numeric" maxLength={3} value={from} onChange={(event) => onFrom(event.target.value)} className={field} />
        <span aria-hidden="true" className="text-[#706d67]">–</span>
        <input aria-label="đến" inputMode="numeric" maxLength={3} value={to} onChange={(event) => onTo(event.target.value)} className={field} />
      </div>
    </div>
  );
}
