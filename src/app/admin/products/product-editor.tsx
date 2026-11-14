"use client";

import Image from "next/image";
import { useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/text-input";
import type { CatalogProduct, CatalogVariant } from "@/lib/catalog";
import { formatPrice } from "@/lib/format";
import { MAX_PRICE, MAX_STOCK, priceError, stockError } from "@/lib/shop-data-validation";
import { compareSizes } from "@/lib/size-order";
import { LOW_STOCK, summarizeStock } from "@/lib/stock";
import { foldSearch } from "../inbox/inbox-filter";
import { INITIAL_FORM_STATE, type FormAction } from "./form-state";

type ProductListProps = {
  products: CatalogProduct[];
  canEdit: boolean;
  saveProduct: FormAction;
  // From the URL (?q=…&stock=low), so the dashboard can link to the low-stock list.
  initialQuery: string;
  initialLowOnly: boolean;
};

// The products tab: one folded card per product, so 60 products fit on a few
// screens. Filtering hides cards instead of unmounting them, so an edit the
// owner has not saved yet survives typing in the search box.
export function ProductList({ products, canEdit, saveProduct, initialQuery, initialLowOnly }: ProductListProps) {
  const [query, setQuery] = useState(initialQuery);
  const [lowOnly, setLowOnly] = useState(initialLowOnly);
  const searchId = useId();

  const folded = foldSearch(query);
  const lowCount = products.filter((product) => summarizeStock(product.variants).low > 0).length;
  const visible = new Set(
    products
      .filter((product) => !lowOnly || summarizeStock(product.variants).low > 0)
      .filter((product) => !folded || foldSearch(`${product.name} ${product.code}`).includes(folded))
      .map((product) => product.id),
  );

  // Keep the URL in step so a reload or a shared link shows the same list.
  function syncUrl(nextQuery: string, nextLow: boolean) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextLow) params.set("stock", "low");
    const search = params.toString();
    window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor={searchId} className="sr-only">Tìm sản phẩm</label>
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#706d67]" />
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="Tìm theo tên hoặc mã, ví dụ AK01"
            onChange={(event) => {
              setQuery(event.target.value);
              syncUrl(event.target.value, lowOnly);
            }}
            className="ui-field min-h-11 w-full pl-9 pr-3 text-base"
          />
        </div>
        <button
          type="button"
          aria-pressed={lowOnly}
          onClick={() => {
            setLowOnly(!lowOnly);
            syncUrl(query, !lowOnly);
          }}
          className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors ${
            lowOnly ? "border-[#171717] bg-[#171717] text-white" : "border-[#d5d0c8] bg-white text-[#171717] hover:border-[#171717]"
          }`}
        >
          Sắp hết hàng
          <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${lowOnly ? "bg-white/20" : "bg-[#fff6e0] text-[#8a5a00]"}`}>{lowCount}</span>
        </button>
      </div>
      <p className="text-sm text-[#706d67]" aria-live="polite">
        {visible.size === products.length ? `${products.length} sản phẩm` : `${visible.size} / ${products.length} sản phẩm`}
        {lowOnly && ` có màu hoặc size còn từ ${LOW_STOCK} cái trở xuống`}
      </p>

      {visible.size === 0 && (
        <EmptyState icon="search" title="Không có sản phẩm khớp" description="Thử từ khóa khác, hoặc tắt lọc Sắp hết hàng." />
      )}
      <ul className="flex flex-col gap-2" aria-label="Danh sách sản phẩm">
        {products.map((product) => (
          <li key={product.id} hidden={!visible.has(product.id)}>
            <ProductCard product={product} canEdit={canEdit} saveProduct={saveProduct} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductCard({ product, canEdit, saveProduct }: { product: CatalogProduct; canEdit: boolean; saveProduct: FormAction }) {
  const stock = summarizeStock(product.variants);

  return (
    <details className="ui-card group overflow-hidden">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-[#faf8f5] sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-[#efebe4]">
          {product.imageUrl ? (
            <Image src={product.imageUrl} alt="" fill sizes="48px" className="object-cover" />
          ) : (
            <Icon name="hanger" className="absolute inset-0 m-auto size-5 text-[#706d67]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{product.name}</span>
          <span className="block text-xs text-[#706d67] tabular-nums">
            {product.code} · {formatPrice(product.price)}
            <span className="sm:hidden"> · {stock.total} trong kho</span>
          </span>
        </span>
        <span className="hidden w-24 shrink-0 text-right text-sm tabular-nums sm:block">
          {stock.total} <span className="text-xs text-[#706d67]">trong kho</span>
        </span>
        {stock.out ? (
          <span className="shrink-0 rounded-full bg-[#fff0eb] px-2.5 py-1 text-xs font-semibold text-[#a83826]">Hết hàng</span>
        ) : stock.low > 0 ? (
          <span className="shrink-0 rounded-full bg-[#fff6e0] px-2.5 py-1 text-xs font-semibold text-[#8a5a00]">{stock.low} mẫu sắp hết</span>
        ) : null}
        <Icon name="chevron" className="size-4 shrink-0 text-[#706d67] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[#e3dfd8] px-4 py-4 sm:px-5">
        {canEdit ? (
          <ProductForm product={product} saveProduct={saveProduct} />
        ) : (
          <StockGrid variants={product.variants} productName={product.name} />
        )}
      </div>
    </details>
  );
}

function ProductForm({ product, saveProduct }: { product: CatalogProduct; saveProduct: FormAction }) {
  const [state, formAction, pending] = useActionState(saveProduct, INITIAL_FORM_STATE);
  // Only what the owner typed; untouched fields show the saved value, which
  // follows the page when an order lowers the stock meanwhile.
  const [priceEdit, setPriceEdit] = useState<string>();
  const [stockEdits, setStockEdits] = useState<Record<string, string>>({});
  const [checkError, setCheckError] = useState<string | null>(null);
  const errorId = useId();

  const price = priceEdit ?? String(product.price);
  const stockOf = (variant: CatalogVariant) => stockEdits[variant.id] ?? String(variant.stock);
  const changedRows = product.variants.filter((variant) => stockOf(variant).trim() !== String(variant.stock));
  const dirty = price.trim() !== String(product.price) || changedRows.length > 0;
  const invalid = new Set(changedRows.filter((variant) => stockError(stockOf(variant))).map((variant) => variant.id));
  const error = checkError ?? (dirty ? state.error : null);
  const saved = state !== INITIAL_FORM_STATE && state.error === null && !dirty && !pending;
  const priceNumber = priceError(price) ? null : Number(price.trim());

  // Leaving the page with typed but unsaved numbers asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const priceProblem = priceError(price);
    const badRow = changedRows.find((variant) => stockError(stockOf(variant)));
    const message = priceProblem ?? (badRow ? `${badRow.color} / ${badRow.size}: ${stockError(stockOf(badRow))}` : null);
    if (message) {
      event.preventDefault();
      setCheckError(message);
    }
  }

  function discard() {
    setPriceEdit(undefined);
    setStockEdits({});
    setCheckError(null);
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" aria-describedby={error ? errorId : undefined}>
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="stocks" value={JSON.stringify(changedRows.map((variant) => ({ variantId: variant.id, stock: stockOf(variant) })))} />
      <div className="max-w-60">
        <TextInput
          label="Giá bán (đồng)"
          name="price"
          inputMode="numeric"
          maxLength={String(MAX_PRICE).length}
          value={price}
          aria-invalid={priceError(price) && price.trim() !== String(product.price) ? true : undefined}
          onChange={(event) => {
            setCheckError(null);
            setPriceEdit(event.target.value);
          }}
        />
        <p className="mt-1 text-xs text-[#706d67] tabular-nums">{priceNumber === null ? "Nhập số, không dấu chấm" : `Khách thấy: ${formatPrice(priceNumber)}`}</p>
      </div>

      <StockGrid
        variants={product.variants}
        productName={product.name}
        edit={{
          value: stockOf,
          invalid: (variant) => invalid.has(variant.id),
          onChange: (variant, value) => {
            setCheckError(null);
            setStockEdits((current) => ({ ...current, [variant.id]: value }));
          },
        }}
      />

      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
      {saved && <p role="status" className="text-sm text-[#2f6b3a]">Đã lưu. AI báo giá và tồn kho mới từ câu hỏi tiếp theo.</p>}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty && !pending && (
          <>
            <span className="mr-auto text-xs text-[#706d67]">Chưa lưu{changedRows.length > 0 ? ` · ${changedRows.length} ô tồn kho đã sửa` : ""}</span>
            <Button type="button" variant="secondary" onClick={discard}>Bỏ thay đổi</Button>
          </>
        )}
        <Button type="submit" loading={pending} loadingText="Đang lưu…" disabled={!dirty}>
          Lưu sản phẩm
        </Button>
      </div>
    </form>
  );
}

type StockEdit = {
  value: (variant: CatalogVariant) => string;
  invalid: (variant: CatalogVariant) => boolean;
  onChange: (variant: CatalogVariant, value: string) => void;
};

// Stock as a color × size table, the way the owner counts the rack. Read-only
// for staff; inputs for the owner.
function StockGrid({ variants, productName, edit }: { variants: CatalogVariant[]; productName: string; edit?: StockEdit }) {
  if (variants.length === 0) {
    return <p className="text-sm text-[#706d67]">Sản phẩm này chưa có màu và size nào.</p>;
  }
  const sizes = [...new Set(variants.map((variant) => variant.size))].toSorted(compareSizes);
  const colors = [...new Set(variants.map((variant) => variant.color))];
  const find = (color: string, size: string) => variants.find((variant) => variant.color === color && variant.size === size);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm tabular-nums">
        <caption className="pb-2 text-left text-sm font-medium text-[#474640]"><span className="sr-only">{productName}: </span>Tồn kho theo màu và size</caption>
        <thead className="text-xs text-[#706d67]">
          <tr>
            <th scope="col" className="py-2 pr-3 text-left font-medium">Màu</th>
            {sizes.map((size) => (
              <th key={size} scope="col" className="w-20 px-1 py-2 text-center font-medium">{size}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {colors.map((color) => (
            <tr key={color} className="border-t border-[#efebe4]">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium">{color}</th>
              {sizes.map((size) => {
                const variant = find(color, size);
                if (!variant) {
                  return (
                    <td key={size} className="px-1 py-1.5 text-center text-[#706d67]">
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">Không bán {color} size {size}</span>
                    </td>
                  );
                }
                if (!edit) {
                  const low = variant.stock <= LOW_STOCK;
                  return (
                    <td key={size} className={`px-1 py-1.5 text-center ${low ? "font-semibold text-[#a83826]" : ""}`}>
                      <span className="sr-only">Tồn kho: {size} / {color}: </span>
                      {variant.stock}
                    </td>
                  );
                }
                return (
                  <td key={size} className="px-1 py-1.5">
                    <input
                      aria-label={`Tồn kho: ${size} / ${color}`}
                      inputMode="numeric"
                      maxLength={String(MAX_STOCK).length}
                      value={edit.value(variant)}
                      aria-invalid={edit.invalid(variant) || undefined}
                      onChange={(event) => edit.onChange(variant, event.target.value)}
                      className={`ui-field min-h-11 w-full min-w-16 px-2 text-center text-base aria-invalid:border-[#b2382a] ${
                        edit.value(variant).trim() !== String(variant.stock) ? "border-[#171717] bg-[#faf8f5] font-semibold" : ""
                      }`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-[#706d67]">
        {edit ? "Ô viền đậm là ô đã sửa, chưa lưu." : `Số đỏ: còn từ ${LOW_STOCK} cái trở xuống.`}
      </p>
    </div>
  );
}
