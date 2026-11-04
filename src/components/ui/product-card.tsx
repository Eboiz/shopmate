import Image from "next/image";
import type { ReactNode } from "react";
import { formatPrice } from "@/lib/format";

// Replace with the `products[]` item type once PB-00 merges.
type ProductCardProps = {
  name: string;
  price: number;
  imageUrl?: string | null;
  sizesInStock?: string[];
  colors?: string[];
  action?: ReactNode;
};

export function ProductCard({
  name,
  price,
  imageUrl,
  sizesInStock,
  colors,
  action,
}: ProductCardProps) {
  return (
    <article className="flex flex-col overflow-hidden rounded-md border border-zinc-200">
      <div className="relative aspect-square bg-zinc-100">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={name}
            fill
            sizes="(max-width: 448px) 50vw, 224px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-sm text-zinc-500">
            Chưa có ảnh
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="font-medium">{name}</h3>
        <p className="font-semibold">{formatPrice(price)}</p>
        {colors && colors.length > 0 && (
          <p className="text-sm text-zinc-500">Màu: {colors.join(", ")}</p>
        )}
        {sizesInStock && (
          <p className="text-sm text-zinc-500">
            {sizesInStock.length > 0
              ? `Size còn hàng: ${sizesInStock.join(", ")}`
              : "Hết hàng"}
          </p>
        )}
        {action && <div className="mt-auto pt-2">{action}</div>}
      </div>
    </article>
  );
}
