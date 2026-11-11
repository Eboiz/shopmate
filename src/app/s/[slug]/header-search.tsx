"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPrice } from "@/lib/format";
import { matchesQuery, productGroup } from "@/lib/shop/catalog-view";
import type { ShopProduct } from "@/lib/shop/types";

const MAX_SUGGESTIONS = 5;

type Props = {
  products: ShopProduct[];
  productHref: (productId: string) => string;
  // Shows every match in the product grid.
  onSearch: (query: string) => void;
  // Nothing matched: let the shopper ask the AI instead.
  onAsk: (text: string) => void;
  className?: string;
};

// The header search finds products: matches drop down as the shopper types,
// and Enter (or "Xem tất cả") filters the product grid below.
export function HeaderSearch({ products, productHref, onSearch, onAsk, className = "" }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const trimmed = query.trim();
  const matches = trimmed
    ? products.filter((product) => matchesQuery([product.name, product.category, productGroup(product.category, product.name), ...product.colors], trimmed))
    : [];
  const showList = open && trimmed !== "";

  function showAll() {
    if (!trimmed) return;
    setOpen(false);
    onSearch(trimmed);
  }

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
    >
      <form role="search" onSubmit={(event) => { event.preventDefault(); showAll(); }} className="flex min-h-11 items-center gap-2 border-[1.5px] border-[#171717] bg-white pl-3 pr-1 focus-within:shadow-[0_0_0_3px_#c2412b40]">
        <input
          type="search"
          aria-label="Tìm sản phẩm trong shop"
          placeholder="Tìm sản phẩm, màu, nhóm..."
          autoComplete="off"
          maxLength={100}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#706d67]"
        />
        <button type="submit" aria-label="Tìm" className="inline-grid size-9 shrink-0 place-items-center bg-[#e9573f] text-[#171717] hover:bg-[#c2412b] hover:text-white"><Icon name="search" className="size-[18px]" /></button>
      </form>

      {showList && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 border-[1.5px] border-[#171717] bg-white shadow-[0_24px_40px_-24px_#17171780] lg:left-auto lg:w-[380px]">
          {matches.length > 0 ? (
            <>
              <p className="border-b border-[#e3dfd8] px-3 py-2 text-xs font-semibold text-[#706d67]">{matches.length} sản phẩm khớp “{trimmed}”</p>
              <ul aria-label="Gợi ý sản phẩm">
                {matches.slice(0, MAX_SUGGESTIONS).map((product) => (
                  <li key={product.id}>
                    <Link href={productHref(product.id)} onClick={() => setOpen(false)} className="flex items-center gap-3 px-3 py-2 hover:bg-[#f5f3ef] focus-visible:bg-[#f5f3ef]">
                      <span className="relative size-12 shrink-0 overflow-hidden bg-[#efebe4]">
                        <Image src={product.imageUrl || "/images/product-placeholder.jpg"} alt="" fill sizes="48px" className="object-cover" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{product.name}</span>
                        <span className="block text-xs text-[#706d67]">
                          <span className="tabular-nums">{formatPrice(product.price)}</span>
                          {" · "}
                          {product.sizesInStock.length > 0 ? `Còn size ${product.sizesInStock.join(", ")}` : "Hết hàng"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={showAll} className="block w-full border-t border-[#e3dfd8] px-3 py-2.5 text-left text-xs font-extrabold uppercase tracking-[.1em] hover:bg-[#f5f3ef]">
                Xem tất cả {matches.length} kết quả →
              </button>
            </>
          ) : (
            <div className="space-y-2 px-3 py-3 text-sm">
              <p>Không có sản phẩm khớp “{trimmed}”.</p>
              <button type="button" onClick={() => { setOpen(false); onAsk(`Shop có ${trimmed} không?`); }} className="text-xs font-extrabold uppercase tracking-[.1em] underline hover:text-[#c2412b]">
                Hỏi trợ lý AI giúp
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
