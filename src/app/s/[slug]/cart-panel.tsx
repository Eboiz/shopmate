"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPrice } from "@/lib/format";
import { displayColor } from "@/lib/shop/catalog-view";
import { CART_MAX_LINES, cartSubtotal, type CartItem } from "./cart";

type Props = {
  items: CartItem[];
  shippingPolicy?: string;
  onQuantity: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
  onSend: () => void;
  onClose: () => void;
};

export function CartPanel({ items, shippingPolicy, onQuantity, onRemove, onSend, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const subtotal = cartSubtotal(items);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    function onEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default bg-[#17171766]" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="gio-dat-title" className="ui-chat-enter relative flex h-dvh w-full flex-col bg-white shadow-2xl sm:w-[420px]">
        <header className="flex items-center justify-between gap-3 border-b border-[#e3dfd8] px-5 py-4">
          <h2 id="gio-dat-title" className="text-lg font-bold">Giỏ đặt hàng</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng giỏ" className="-mr-2 inline-grid size-11 place-items-center rounded-lg hover:bg-[#f5f3ef]"><Icon name="close" className="size-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {items.length === 0 ? (
            <p className="py-10 text-sm leading-6 text-[#706d67]">Giỏ đang trống. Chọn màu, size ở trang sản phẩm rồi bấm “Thêm vào giỏ”.</p>
          ) : (
            <ul aria-label="Món trong giỏ">
              {items.map((item, index) => (
                <li key={`${item.productId}-${item.color}-${item.size}`} className="grid grid-cols-[64px_1fr] gap-3 border-b border-[#e3dfd8] py-4">
                  <div className="relative h-20 w-16 overflow-hidden rounded-md bg-[#eeebe5]">
                    <Image src={item.imageUrl ?? "/images/product-placeholder.jpg"} alt="" fill sizes="64px" className="object-cover" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{item.name}</p>
                    <p className="mt-0.5 text-xs text-[#706d67]">{[item.color && displayColor(item.color), item.size && `Size ${item.size}`].filter(Boolean).join(" · ")}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <div className="flex items-center overflow-hidden rounded-lg border border-[#8f8a82]">
                        <button type="button" aria-label={`Giảm số lượng ${item.name}`} disabled={item.quantity <= 1} onClick={() => onQuantity(index, item.quantity - 1)} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">−</button>
                        <output aria-label="Số lượng" className="min-w-8 text-center text-sm font-semibold tabular-nums">{item.quantity}</output>
                        <button type="button" aria-label={`Tăng số lượng ${item.name}`} disabled={item.quantity >= 99} onClick={() => onQuantity(index, item.quantity + 1)} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">+</button>
                      </div>
                      <span className="text-sm font-bold tabular-nums">{formatPrice(item.price * item.quantity)}</span>
                      <button type="button" onClick={() => onRemove(index)} aria-label={`Bỏ ${item.name} khỏi giỏ`} title="Bỏ khỏi giỏ" className="ml-auto inline-grid size-11 place-items-center rounded-lg text-[#b2382a] hover:bg-[#fff0eb]"><Icon name="trash" className="size-5" /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
