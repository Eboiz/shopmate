import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatPrice, formatSizesInStock } from "@/lib/format";
import { displayColor, sizeRange } from "@/lib/shop/catalog-view";

type ProductCardProps = {
  name: string;
  price: number;
  imageUrl?: string | null;
  sizesInStock?: string[];
  colors?: string[];
  action?: ReactNode;
  href?: string;
  compact?: boolean;
};

// The whole card opens the product: the name link stretches over it, so there
// is one link per card and no button repeated sixty times down the page.
export function ProductCard({
  name,
  price,
  imageUrl,
  sizesInStock,
  colors,
  action,
  href,
  compact = false,
}: ProductCardProps) {
  const sizes = compact ? "112px" : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw";
  const image = imageUrl ? (
    <Image src={imageUrl} alt="" fill sizes={sizes} className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
  ) : (
    // No shop photo yet: a neutral stock photo, not a coloured block.
    <Image src="/images/product-placeholder.jpg" alt="" fill sizes={sizes} className="object-cover" />
  );
  const imageClass = `relative shrink-0 overflow-hidden bg-[#eeebe5] ${compact ? "w-24 self-stretch sm:w-28" : "aspect-[4/5] w-full"}`;
  // Full cards: "3 màu · S–L". Chat cards keep the stock line every channel uses.
  const summary = compact
    ? sizesInStock && formatSizesInStock(sizesInStock)
    : sizesInStock && sizesInStock.length === 0
      ? "Hết hàng"
      : [colors && colors.length > 0 && (colors.length === 1 ? displayColor(colors[0]) : `${colors.length} màu`), sizesInStock && sizeRange(sizesInStock)]
          .filter(Boolean)
          .join(" · ");

  return (
    <article className={`group relative h-full overflow-hidden rounded-xl border border-[#e3dfd8] bg-white transition-[transform,box-shadow] duration-300 ${href ? "hover:-translate-y-1 hover:shadow-[0_22px_50px_-32px_#17171788] focus-within:ring-2 focus-within:ring-[#e9573f] focus-within:ring-offset-2" : ""} ${compact ? "flex" : "flex flex-col"}`}>
      <div className={imageClass}>{image}</div>
      <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${compact ? "p-3" : "p-3 sm:p-4"}`}>
        <h3 className="font-semibold leading-snug text-[#171717]">
          {href ? <Link href={href} scroll={false} className="outline-none after:absolute after:inset-0 group-hover:underline">{name}</Link> : name}
        </h3>
        <p className="font-bold tabular-nums text-[#c2412b]">{formatPrice(price)}</p>
        {summary && <p className="text-xs text-[#706d67]">{summary}</p>}
        {action && <div className="relative z-10 mt-auto pt-2">{action}</div>}
      </div>
    </article>
  );
}

// Same frame as ProductCard while the catalog loads, so the grid doesn't jump.
export function ProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col overflow-hidden rounded-xl border border-[#e3dfd8] bg-white">
      <div className="aspect-[4/5] w-full animate-pulse bg-[#e6e1d8]" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="h-4 w-4/5 animate-pulse rounded-md bg-[#e6e1d8]" />
        <div className="h-4 w-1/3 animate-pulse rounded-md bg-[#e6e1d8]" />
        <div className="h-3 w-2/3 animate-pulse rounded-md bg-[#e6e1d8]" />
      </div>
    </div>
  );
}
