"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/format";
import { compareSizes } from "@/lib/size-order";
import { displayColor, firstSentence, productGroup } from "@/lib/shop/catalog-view";
import type { ShopCatalog, ShopProduct } from "@/lib/shop/types";
import type { CartItem } from "./cart";
import { SizeGuide } from "./size-guide";

type Policies = NonNullable<ShopCatalog["shop"]["policies"]>;

type Props = {
  shopName: string;
  product: ShopProduct;
  shopHref: string;
  policies?: Policies;
  cartCount: number;
  onAsk: (product: ShopProduct, initialMessage?: string) => void;
  // False when the basket is full.
  onAddToCart: (item: CartItem, maxQuantity: number) => boolean;
  onOpenCart: () => void;
};

export function ProductDetailView({ shopName, product, shopHref, policies, cartCount, onAsk, onAddToCart, onOpenCart }: Props) {
  const availableVariants = product.variants?.filter((variant) => variant.stock > 0);
  const colors = availableVariants
    ? [...new Set(availableVariants.map((variant) => variant.color))]
    : product.colors;
  const [color, setColor] = useState(colors[0] ?? "");
  const sizes = availableVariants
    ? [...new Set(availableVariants.filter((variant) => variant.color === color).map((variant) => variant.size))].sort(compareSizes)
    : [...product.sizesInStock].sort(compareSizes);
  const [size, setSize] = useState(sizes[0] ?? "");
  const [quantity, setQuantity] = useState(1);
  const [cartNotice, setCartNotice] = useState("");
  const selectedVariant = availableVariants?.find((variant) => variant.color === color && variant.size === size);
  const maxQuantity = selectedVariant?.stock ?? 99;
  const canOrder = sizes.length > 0 && size !== "" && maxQuantity > 0;
  const group = productGroup(product.category, product.name);
  const sizeChart = product.sizeChart ?? [];
  const policyItems = [
    { title: "Đổi trả", text: policies?.returns ?? "" },
    { title: "Giao hàng", text: policies?.shipping ?? "" },
  ].filter((item) => item.text);

  useEffect(() => {
    if (!cartNotice) return;
    const timer = window.setTimeout(() => setCartNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [cartNotice]);

  function changeColor(nextColor: string) {
    setColor(nextColor);
    setQuantity(1);
    if (availableVariants) {
      const firstSize = availableVariants.find((variant) => variant.color === nextColor)?.size;
      setSize(firstSize ?? "");
    }
  }

  function pickSize(nextSize: string) {
    setSize(nextSize);
    setQuantity(1);
  }

  function requestOrder() {
    if (!canOrder) return;
    const details = [color && `màu ${color}`, size && `size ${size}`, `số lượng ${quantity}`].filter(Boolean).join(", ");
    onAsk(product, `Mình muốn đặt ${product.name} (${details}). Shop xác nhận giúp mình nhé.`);
  }

  function addToCart() {
    if (!canOrder) return;
    const added = onAddToCart(
      { productId: product.id, name: product.name, price: product.price, imageUrl: product.imageUrl, color, size, quantity },
      maxQuantity,
    );
    setCartNotice(added ? "Đã thêm vào giỏ." : "Giỏ đã đủ 10 món. Gửi đơn này trước rồi thêm tiếp nhé.");
  }

  const optionClass = (active: boolean) =>
    `min-h-11 rounded-lg border px-4 text-sm font-medium transition-colors ${active ? "border-[#c2412b] bg-[#fff0eb] text-[#a83826]" : "border-[#8f8a82] hover:border-[#171717]"}`;

  return (
    <div className="min-h-dvh bg-[#f5f3ef]">
      <header className="sticky top-0 z-20 border-b border-[#e3dfd8] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-10">
          <Link href={shopHref} className="flex min-w-0 items-center gap-3">
            <Image src="/images/shop-avatar.jpg" alt="" width={36} height={36} className="size-9 shrink-0 object-cover" />
            <span className="truncate text-lg font-black uppercase tracking-[-.04em] sm:text-xl">{shopName}<span className="text-[#e9573f]">.</span></span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onOpenCart} className="inline-flex min-h-11 items-center rounded-lg border border-[#8f8a82] px-4 text-sm font-bold transition-colors hover:border-[#171717]">Giỏ ({cartCount})</button>
            <button type="button" aria-label="Chat với shop" onClick={() => onAsk(product)} className="inline-flex min-h-11 items-center rounded-lg border border-[#171717] px-4 text-sm font-bold transition-colors hover:bg-[#171717] hover:text-white">Chat</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <nav aria-label="Đường dẫn trang" className="mb-6 flex flex-wrap items-center gap-2 text-xs text-[#706d67]">
          <Link href={shopHref} className="hover:text-[#c2412b]">Cửa hàng</Link><span aria-hidden="true">/</span>
          <Link href={`${shopHref}#san-pham`} className="hover:text-[#c2412b]">{group}</Link><span aria-hidden="true">/</span>
          <span aria-current="page" className="font-semibold text-[#171717]">{product.name}</span>
        </nav>

        <div className="grid overflow-hidden rounded-xl border border-[#e3dfd8] bg-white shadow-[0_20px_60px_-44px_#17171766] lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
          <div className="p-4 sm:p-6">
            <div className="relative aspect-square overflow-hidden rounded-lg bg-[#eeebe5]">
              {product.imageUrl ? (
                <Image src={product.imageUrl} alt={product.name} fill priority sizes="(max-width: 1024px) 100vw, 48vw" className="object-cover" />
              ) : (
                <Image src="/images/product-placeholder.jpg" alt="" fill priority sizes="(max-width: 1024px) 100vw, 48vw" className="object-cover" />
              )}
            </div>
          </div>

          <div className="flex flex-col border-t border-[#e3dfd8] p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
            <h1 className="text-3xl font-extrabold leading-tight tracking-[-.04em] text-[#171717] sm:text-4xl">{product.name}</h1>
            <p className="mt-4 text-3xl font-bold tabular-nums text-[#c2412b] sm:text-4xl">{formatPrice(product.price)}</p>
            {product.description && <p className="mt-5 whitespace-pre-line text-sm leading-7 text-[#474640]">{product.description}</p>}

            {colors.length > 0 && (
              <fieldset className="mt-7">
                <legend className="mb-3 text-sm font-semibold">Màu sắc <span className="font-normal text-[#706d67]">· {displayColor(color)}</span></legend>
                <div className="flex flex-wrap gap-2">
                  {colors.map((item) => <button key={item} type="button" aria-pressed={color === item} onClick={() => changeColor(item)} className={optionClass(color === item)}>{displayColor(item)}</button>)}
                </div>
              </fieldset>
            )}
            <fieldset className="mt-6">
              <legend className="mb-3 flex w-full items-baseline justify-between gap-3 text-sm font-semibold">
                <span>Size</span>
                {sizeChart.length > 0 && <a href="#bang-size" className="font-semibold text-[#c2412b] underline-offset-4 hover:underline">Bảng size</a>}
              </legend>
              {sizes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {sizes.map((item) => <button key={item} type="button" aria-pressed={size === item} onClick={() => pickSize(item)} className={`${optionClass(size === item)} min-w-12 px-3 font-semibold`}>{item}</button>)}
                </div>
              ) : <p className="text-sm text-[#706d67]">Chưa có size còn hàng.</p>}
            </fieldset>

            {canOrder && (
              <div className="mt-6 flex items-center gap-4">
                <span className="text-sm font-semibold">Số lượng</span>
                <div className="flex items-center overflow-hidden rounded-lg border border-[#8f8a82]">
                  <button type="button" aria-label="Giảm số lượng" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">−</button>
                  <output className="min-w-10 text-center text-sm font-semibold tabular-nums">{quantity}</output>
                  <button type="button" aria-label="Tăng số lượng" disabled={quantity >= maxQuantity} onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">+</button>
                </div>
                {selectedVariant && <span className="text-xs text-[#706d67]">Còn {selectedVariant.stock} sản phẩm</span>}
              </div>
            )}

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={addToCart} disabled={!canOrder} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#171717] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#33312d] disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2">Thêm vào giỏ</button>
              <button type="button" onClick={() => onAsk(product)} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#171717] px-5 text-sm font-semibold transition-colors hover:bg-[#f5f3ef]">Hỏi shop</button>
              <button type="button" onClick={requestOrder} disabled={!canOrder} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#c2412b] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#a83826] disabled:cursor-not-allowed disabled:opacity-50">Đặt qua chat</button>
            </div>
            <p aria-live="polite" className="mt-3 min-h-5 text-sm font-semibold">
              {cartNotice && (
                <>
                  {cartNotice}{" "}
                  {cartNotice.startsWith("Đã") && <button type="button" onClick={onOpenCart} className="min-h-11 text-[#c2412b] underline-offset-4 hover:underline">Xem giỏ</button>}
                </>
              )}
            </p>
            <p className="text-xs leading-5 text-[#706d67]">Shop xác nhận tồn kho và phí giao trong chat trước khi tạo đơn.</p>

            {policyItems.length > 0 && (
              <div className="mt-6 divide-y divide-[#e3dfd8] border-y border-[#e3dfd8]">
                {policyItems.map((item) => (
                  <details key={item.title} className="group py-3">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm">
                      <span><strong>{item.title}:</strong> {firstSentence(item.text)}</span>
                      <span aria-hidden="true" className="shrink-0 text-xs font-semibold text-[#706d67] group-open:hidden">Xem thêm</span>
                      <span aria-hidden="true" className="hidden shrink-0 text-xs font-semibold text-[#706d67] group-open:inline">Thu gọn</span>
                    </summary>
                    <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#474640]">{item.text}</p>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>

        {sizeChart.length > 0 && (
          <SizeGuide
            rows={sizeChart}
            availableSizes={sizes}
            onPick={pickSize}
            onAsk={(message) => onAsk(product, message)}
          />
        )}
      </div>
    </div>
  );
}
