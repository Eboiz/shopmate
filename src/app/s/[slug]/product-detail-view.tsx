"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPrice } from "@/lib/format";
import { compareSizes } from "@/lib/size-order";
import type { ShopProduct } from "@/lib/shop/types";

type Props = {
  shopName: string;
  product: ShopProduct;
  shopHref: string;
  loginHref: string;
  onAsk: (product: ShopProduct, initialMessage?: string) => void;
};

export function ProductDetailView({ shopName, product, shopHref, loginHref, onAsk }: Props) {
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
  const selectedVariant = availableVariants?.find((variant) => variant.color === color && variant.size === size);
  const maxQuantity = selectedVariant?.stock ?? 99;
  const canOrder = sizes.length > 0 && size !== "" && maxQuantity > 0;

  function changeColor(nextColor: string) {
    setColor(nextColor);
    setQuantity(1);
    if (availableVariants) {
      const firstSize = availableVariants.find((variant) => variant.color === nextColor)?.size;
      setSize(firstSize ?? "");
    }
  }

  function requestOrder() {
    if (!canOrder) return;
    const details = [color && `màu ${color}`, size && `size ${size}`, `số lượng ${quantity}`].filter(Boolean).join(", ");
    onAsk(product, `Mình muốn đặt ${product.name} (${details}). Shop xác nhận giúp mình nhé.`);
  }

  return (
    <div className="min-h-dvh bg-[#f5f3ef]">
      <header className="sticky top-0 z-20 border-b border-[#e3dfd8] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-10">
          <Link href={shopHref} className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center bg-[#171717] text-xl font-black text-white">S</span>
            <span className="truncate text-lg font-black uppercase tracking-[-.05em] sm:text-xl">{shopName}<span className="text-[#e9573f]">.</span></span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={loginHref} aria-label="Đăng nhập quản lý" title="Đăng nhập quản lý" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d5d0c8] px-3 text-xs font-bold hover:border-[#171717]"><Icon name="login" className="size-4" /><span className="hidden lg:inline">Đăng nhập</span></Link>
            <button type="button" onClick={() => onAsk(product)} aria-label="Mở trò chuyện với shop" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#171717] px-3 text-xs font-bold transition-colors hover:bg-[#171717] hover:text-white"><Icon name="chat" className="size-4" /><span className="hidden sm:inline">Hỏi shop</span></button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <nav aria-label="Đường dẫn trang" className="mb-6 flex flex-wrap items-center gap-2 text-xs text-[#706d67]">
          <Link href={shopHref} className="hover:text-[#e9573f]">Cửa hàng</Link><span>/</span>
          <Link href={`${shopHref}#san-pham`} className="hover:text-[#e9573f]">Sản phẩm</Link><span>/</span>
          <span aria-current="page" className="font-semibold text-[#171717]">{product.name}</span>
        </nav>

        <div className="grid overflow-hidden rounded-xl border border-[#e3dfd8] bg-white shadow-[0_20px_60px_-44px_#17171766] lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)]">
          <div className="p-4 sm:p-6">
            <div className="relative aspect-square overflow-hidden rounded-lg bg-[#eeebe5]">
              {product.imageUrl ? (
                <Image src={product.imageUrl} alt={product.name} fill priority sizes="(max-width: 1024px) 100vw, 48vw" className="object-cover" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[linear-gradient(140deg,#f2eee8,#ded8ce)] text-[#171717]">
                  <span aria-hidden="true" className="text-8xl">✳</span>
                  <span className="text-xs font-bold uppercase tracking-[.2em]">ShopMate selection</span>
                </div>
              )}
            </div>
            <p className="mt-3 text-xs text-[#706d67]">Ảnh sản phẩm do cửa hàng cung cấp</p>
          </div>

          <div className="flex flex-col border-t border-[#e3dfd8] p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
            {product.category && <p className="ui-eyebrow mb-3">{product.category}</p>}
            <h1 className="text-3xl font-extrabold leading-tight tracking-[-.04em] text-[#171717] sm:text-4xl">{product.name}</h1>
            <div className="mt-6 rounded-lg bg-[#fff0eb] px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-[#9f5141]">Giá bán</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-[#e9573f] sm:text-4xl">{formatPrice(product.price)}</p>
            </div>

            {colors.length > 0 && <fieldset className="mt-7"><legend className="mb-3 text-sm font-semibold">Màu sắc <span className="font-normal text-[#706d67]">· {color}</span></legend><div className="flex flex-wrap gap-2">{colors.map((item) => <button key={item} type="button" aria-pressed={color === item} onClick={() => changeColor(item)} className={`min-h-11 rounded-lg border px-4 text-sm font-medium transition-colors ${color === item ? "border-[#e9573f] bg-[#fff0eb] text-[#bf442e]" : "border-[#d5d0c8] hover:border-[#171717]"}`}>{item}</button>)}</div></fieldset>}
            <fieldset className="mt-6"><legend className="mb-3 text-sm font-semibold">Kích thước</legend>{sizes.length > 0 ? <div className="flex flex-wrap gap-2">{sizes.map((item) => <button key={item} type="button" aria-pressed={size === item} onClick={() => { setSize(item); setQuantity(1); }} className={`min-h-11 min-w-12 rounded-lg border px-3 text-sm font-semibold transition-colors ${size === item ? "border-[#e9573f] bg-[#fff0eb] text-[#bf442e]" : "border-[#d5d0c8] hover:border-[#171717]"}`}>{item}</button>)}</div> : <p className="text-sm text-[#706d67]">Chưa có size còn hàng.</p>}</fieldset>

            {canOrder && <div className="mt-6 flex items-center gap-4"><span className="text-sm font-semibold">Số lượng</span><div className="flex items-center overflow-hidden rounded-lg border border-[#d5d0c8]"><button type="button" aria-label="Giảm số lượng" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">−</button><output className="min-w-10 text-center text-sm font-semibold tabular-nums">{quantity}</output><button type="button" aria-label="Tăng số lượng" disabled={quantity >= maxQuantity} onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))} className="flex size-11 items-center justify-center text-lg hover:bg-[#f5f3ef] disabled:opacity-40">+</button></div>{selectedVariant && <span className="text-xs text-[#706d67]">Còn {selectedVariant.stock} sản phẩm</span>}</div>}

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => onAsk(product)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[#171717] px-5 text-sm font-semibold transition-colors hover:bg-[#f5f3ef]"><Icon name="chat" className="size-5" /> Hỏi shop</button>
              <button type="button" onClick={requestOrder} disabled={!canOrder} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#e9573f] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#d4442e] disabled:cursor-not-allowed disabled:opacity-50">Đặt qua chat <Icon name="arrow" className="size-4" /></button>
            </div>
            <p className="mt-3 text-xs leading-5 text-[#706d67]">Yêu cầu đặt hàng được soạn sẵn trong chat; shop sẽ xác nhận trước khi tạo đơn.</p>
          </div>
        </div>

        <section className="mt-6 rounded-xl border border-[#e3dfd8] bg-white p-5 sm:p-8">
          <p className="ui-eyebrow mb-2">Thông tin từ cửa hàng</p>
          <h2 className="text-xl font-bold">Chi tiết sản phẩm</h2>
          <dl className="mt-5 grid gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-[#706d67]">Tên sản phẩm</dt><dd className="font-medium">{product.name}</dd>
            {product.category && <><dt className="text-[#706d67]">Danh mục</dt><dd>{product.category}</dd></>}
            <dt className="text-[#706d67]">Màu còn hàng</dt><dd>{colors.length ? colors.join(", ") : "Chưa có"}</dd>
            <dt className="text-[#706d67]">Size còn hàng</dt><dd>{product.sizesInStock.length ? product.sizesInStock.join(", ") : "Chưa có"}</dd>
          </dl>
          {product.description && <div className="mt-6 border-t border-[#e3dfd8] pt-6"><h3 className="mb-3 font-semibold">Mô tả</h3><p className="whitespace-pre-line text-sm leading-7 text-[#474640]">{product.description}</p></div>}
        </section>
      </div>
    </div>
  );
}
