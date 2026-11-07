import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatPrice, formatSizesInStock } from "@/lib/format";

// Replace with the `products[]` item type once PB-00 merges.
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
  const image = imageUrl ? (
    <Image
      src={imageUrl}
      alt={name}
      fill
      sizes={compact ? "112px" : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"}
      className="object-cover transition-transform duration-500 group-hover:scale-[1.06]"
    />
  ) : (
    // No shop photo yet: a neutral stock photo, not a coloured block.
    <Image
      src="/images/product-placeholder.jpg"
      alt=""
      fill
      sizes={compact ? "112px" : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"}
      className="object-cover"
    />
  );
  const imageClass = `relative shrink-0 overflow-hidden bg-[#eeebe5] ${compact ? "w-24 self-stretch sm:w-28" : "aspect-[4/5] w-full"}`;

  return (
    <article className={`group h-full overflow-hidden border border-[#e3dfd8] bg-white transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_-32px_#17171788] ${compact ? "flex rounded-xl" : "flex flex-col rounded-xl"}`}>
      {href ? <Link href={href} scroll={false} aria-label={`Xem chi tiết ${name}`} className={imageClass}>{image}</Link> : <div className={imageClass}>{image}</div>}
      <div className={`flex min-w-0 flex-1 flex-col gap-2 ${compact ? "p-3" : "p-4"}`}>
        <h3 className="font-semibold leading-snug text-[#171717]">{href ? <Link href={href} scroll={false} className="hover:underline">{name}</Link> : name}</h3>
        <p className="font-bold tabular-nums text-[#c2412b]">{formatPrice(price)}</p>
        {colors && colors.length > 0 && (
          <p className="text-xs text-[#706d67]">Màu: {colors.join(", ")}</p>
        )}
        {sizesInStock && (
          <p className="text-xs text-[#706d67]">
            {formatSizesInStock(sizesInStock)}
          </p>
        )}
        {(action || (href && !compact)) && <div className="mt-auto pt-2">{action ?? <Link href={href!} scroll={false} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#171717] px-2 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#c2412b] sm:text-sm">Xem chi tiết</Link>}</div>}
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
        <div className="mt-auto h-11 w-full animate-pulse rounded-lg bg-[#e6e1d8]" />
      </div>
    </div>
  );
}
