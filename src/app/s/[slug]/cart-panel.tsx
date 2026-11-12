"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPrice } from "@/lib/format";
import { displayColor } from "@/lib/shop/catalog-view";
import { CART_MAX_LINES, cartLineKey, cartLineMax, cartSubtotal, type CartItem } from "./cart";
import { useModal } from "./use-modal";

type Props = {
  items: CartItem[];
  shippingPolicy?: string;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onRestore: (item: CartItem, index: number) => boolean;
  onSend: () => void;
  onClose: () => void;
};

export function CartPanel({ items, shippingPolicy, onQuantity, onRemove, onRestore, onSend, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const subtotal = cartSubtotal(items);
  useModal(panelRef);

  // The last line taken out, kept until the next removal or until the panel
  // closes, so "Hoàn tác" never races a timer.
  const [removed, setRemoved] = useState<{ item: CartItem; index: number } | null>(null);
  // The line whose trash button takes focus once "Hoàn tác" has put it back.
  // Cleared as soon as it is used, so later quantity changes leave focus alone.
  const restoredKeyRef = useRef<string | null>(null);
  const showUndo = removed !== null && !items.some((line) => cartLineKey(line) === cartLineKey(removed.item));

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    function onEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  // The trash button disappears with its line: hand focus to "Hoàn tác".
  useEffect(() => {
    if (removed) undoRef.current?.focus({ preventScroll: true });
  }, [removed]);
  useEffect(() => {
    const key = restoredKeyRef.current;
    if (!key) return;
    const trash = panelRef.current?.querySelector<HTMLElement>(`[data-line="${CSS.escape(key)}"] button[data-remove]`);
    if (!trash) return;
    restoredKeyRef.current = null;
    trash.focus({ preventScroll: true });
  }, [items]);

  function remove(item: CartItem, index: number) {
    restoredKeyRef.current = null;
    setRemoved({ item, index });
    onRemove(cartLineKey(item));
  }

  function undo() {
    if (!removed) return;
    if (onRestore(removed.item, removed.index)) restoredKeyRef.current = cartLineKey(removed.item);
    setRemoved(null);
  }

  const undoRow = showUndo && (
    <li key="undo" role="status" className="flex items-center justify-between gap-3 border-b border-[#e3dfd8] py-3 text-sm">
      <span className="min-w-0 text-[#4a4741]">Đã bỏ <span className="font-semibold text-[#171717]">{removed.item.name}</span> khỏi giỏ.</span>
      <button ref={undoRef} type="button" onClick={undo} className="min-h-11 shrink-0 px-2 text-xs font-extrabold uppercase tracking-[.1em] text-[#a83826] underline-offset-4 hover:underline">Hoàn tác</button>
    </li>
  );

  const rows = items.map((item, index) => {
    const key = cartLineKey(item);
    const max = cartLineMax(item);
    return (
      <li key={key} data-line={key} className="grid grid-cols-[64px_1fr] gap-3 border-b border-[#e3dfd8] py-4">
        <div className="relative h-20 w-16 overflow-hidden rounded-md bg-[#eeebe5]">
          <Image src={item.imageUrl ?? "/images/product-placeholder.jpg"} alt="" fill sizes="64px" className="object-cover" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{item.name}</p>
          <p className="mt-0.5 text-xs text-[#706d67]">{[item.color && displayColor(item.color), item.size && `Size ${item.size}`].filter(Boolean).join(" · ")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex items-center overflow-hidden rounded-lg border border-[#8f8a82]">
              <button type="button" aria-label={`Giảm số lượng ${item.name}`} disabled={item.quantity <= 1} onClick={() => onQuantity(key, item.quantity - 1)} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">−</button>
              <output aria-label={`Số lượng ${item.name}`} className="min-w-8 text-center text-sm font-semibold tabular-nums">{item.quantity}</output>
              <button type="button" aria-label={`Tăng số lượng ${item.name}`} disabled={item.quantity >= max} onClick={() => onQuantity(key, item.quantity + 1)} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">+</button>
            </div>
            <span className="text-sm font-bold tabular-nums">{formatPrice(item.price * item.quantity)}</span>
            <button type="button" data-remove onClick={() => remove(item, index)} aria-label={`Bỏ ${item.name} khỏi giỏ`} title="Bỏ khỏi giỏ" className="ml-auto inline-grid size-11 place-items-center rounded-lg text-[#706d67] transition-colors hover:bg-[#fff0eb] hover:text-[#b2382a]"><Icon name="trash" className="size-5" /></button>
          </div>
          {max < 99 && item.quantity >= max && <p className="mt-1.5 text-xs text-[#706d67]">Shop chỉ còn {max} sản phẩm này.</p>}
        </div>
      </li>
    );
  });
  if (undoRow) rows.splice(Math.min(removed.index, rows.length), 0, undoRow);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default bg-[#17171766]" onClick={onClose} />
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="gio-dat-title" className="ui-chat-enter relative flex h-dvh w-full flex-col bg-white shadow-2xl sm:w-[420px]">
        <header className="flex items-center justify-between gap-3 border-b border-[#e3dfd8] px-5 py-4">
          <h2 id="gio-dat-title" className="text-lg font-bold">Giỏ đặt hàng</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng giỏ" className="-mr-2 inline-grid size-11 place-items-center rounded-lg hover:bg-[#f5f3ef]"><Icon name="close" className="size-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {rows.length > 0 && <ul aria-label="Món trong giỏ">{rows}</ul>}
          {items.length === 0 && (
            <p className="py-10 text-sm leading-6 text-[#706d67]">Giỏ đang trống. Chọn màu, size ở trang sản phẩm rồi bấm “Thêm vào giỏ”.</p>
          )}
        </div>

        {items.length > 0 && (
          <footer className="border-t border-[#e3dfd8] px-5 py-4">
            {items.length >= CART_MAX_LINES && <p role="status" className="mb-3 bg-[#fff0eb] px-3 py-2 text-xs font-semibold leading-5 text-[#a83826]">Giỏ đã đủ {CART_MAX_LINES} món. Gửi đơn này trước rồi thêm tiếp nhé.</p>}
            <p className="flex justify-between text-base font-bold"><span>Tạm tính</span><span className="tabular-nums">{formatPrice(subtotal)}</span></p>
            <p className="mt-1 text-xs leading-5 text-[#706d67]">
              {shippingPolicy ? `Giao hàng: ${shippingPolicy}` : "Phí giao hàng: shop báo khi xác nhận đơn."}
            </p>
            <button type="button" onClick={onSend} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#c2412b] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#a83826]">Soạn tin đặt hàng →</button>
            <p className="mt-2 text-xs leading-5 text-[#706d67]">Tin đặt hàng hiện sẵn trong chat, bấm Gửi để gửi cho shop. Shop kiểm tra tồn kho và xác nhận trước khi giao.</p>
          </footer>
        )}
      </section>
    </div>
  );
}
