"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPrice } from "@/lib/format";
import { displayColor } from "@/lib/shop/catalog-view";
import type { ShopProduct } from "@/lib/shop/types";
import type { CartItem } from "./cart";
import { productOptions } from "./product-options";
import { useModal } from "./use-modal";

export function cartItemFor(product: ShopProduct, color: string, size: string): CartItem {
  return { productId: product.id, name: product.name, price: product.price, imageUrl: product.imageUrl, color, size, quantity: 1 };
}

type Props = {
  product: ShopProduct;
  onAdd: (item: CartItem, maxQuantity: number) => void;
  onClose: () => void;
};

// Pick colour and size from the product grid without opening the product page.
export function QuickAdd({ product, onAdd, onClose }: Props) {
  const { colors, sizesFor, inStockSizesFor, sizeState, isColorSoldOut, defaultColor, stockOf } = productOptions(product);
  const [color, setColor] = useState(defaultColor);
  const sizes = sizesFor(color);
  const inStockSizes = inStockSizesFor(color);
  const soldOutSizes = sizes.filter((option) => sizeState(color, option) === "sold_out");
  const [size, setSize] = useState(inStockSizes.length === 1 ? inStockSizes[0] : "");
  const panelRef = useRef<HTMLElement>(null);
  useModal(panelRef);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button[data-option]:not(:disabled)")?.focus({ preventScroll: true });
    function onEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
      opener?.focus({ preventScroll: true });
    };
  }, [onClose]);

  function changeColor(next: string) {
    setColor(next);
    const nextSizes = inStockSizesFor(next);
    setSize(nextSizes.includes(size) ? size : nextSizes.length === 1 ? nextSizes[0] : "");
  }

  const canAdd = size !== "" && inStockSizes.includes(size);
  const optionClass = (active: boolean) =>
    `min-h-11 min-w-11 rounded-lg border px-3 text-sm font-medium transition-colors ${active ? "border-[#c2412b] bg-[#fff0eb] text-[#a83826]" : "border-[#8f8a82] hover:border-[#171717]"} disabled:cursor-not-allowed disabled:border-[#d6d1c9] disabled:bg-[#f5f3ef] disabled:text-[#8f8a82] disabled:line-through`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default bg-[#17171766]" onClick={onClose} />
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="quick-add-title" className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex gap-4">
          <span className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-[#efebe4]">
            <Image src={product.imageUrl || "/images/product-placeholder.jpg"} alt="" fill sizes="80px" className="object-cover" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="quick-add-title" className="font-semibold leading-snug">{product.name}</h2>
            <p className="mt-1 font-bold tabular-nums text-[#c2412b]">{formatPrice(product.price)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="-mr-2 -mt-2 inline-grid size-11 shrink-0 place-items-center rounded-lg hover:bg-[#f5f3ef]"><Icon name="close" className="size-4" /></button>
        </div>

        {colors.length > 0 && (
          <fieldset className="mt-5">
            <legend className="mb-2 text-sm font-semibold">Màu: <span className="font-normal">{color ? displayColor(color) : "—"}</span></legend>
            <div className="flex flex-wrap gap-2">
              {colors.map((option) => (
                <button key={option} type="button" data-option aria-pressed={option === color} onClick={() => changeColor(option)} className={optionClass(option === color)}>
                  {displayColor(option)}
                  {isColorSoldOut(option) && <span className="ml-1 text-xs font-normal text-[#706d67]">· Hết hàng</span>}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-semibold">Size{size ? `: ${size}` : ""}</legend>
          {sizes.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {sizes.map((option) => {
                const soldOut = sizeState(color, option) === "sold_out";
                return (
                  <button key={option} type="button" data-option disabled={soldOut} aria-label={soldOut ? `Size ${option}, hết hàng` : undefined} title={soldOut ? "Hết hàng" : undefined} aria-pressed={option === size} onClick={() => setSize(option)} className={optionClass(option === size)}>{option}</button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[#706d67]">Màu này chưa có size.</p>
          )}
          {soldOutSizes.length > 0 && (
            <p className="mt-2 text-xs text-[#706d67]">{inStockSizes.length > 0 ? `Hết hàng: size ${soldOutSizes.join(", ")}` : "Màu này đã hết hàng."}</p>
          )}
        </fieldset>

        <button
          type="button"
          disabled={!canAdd}
          onClick={() => onAdd(cartItemFor(product, color, size), stockOf(color, size))}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center bg-[#171717] px-5 text-xs font-extrabold uppercase tracking-[.12em] text-white transition-colors hover:bg-[#c2412b] disabled:cursor-not-allowed disabled:bg-[#bdb8b0]"
        >
          {canAdd ? "Thêm vào giỏ" : inStockSizes.length === 0 ? "Màu này đã hết hàng" : "Chọn size để thêm vào giỏ"}
        </button>
      </section>
    </div>
  );
}
