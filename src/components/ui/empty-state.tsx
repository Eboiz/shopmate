import Image from "next/image";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#d5d0c8] bg-white px-6 py-12 text-center">
      <Image src="/images/product-placeholder.jpg" alt="" width={64} height={64} className="mb-1 size-16 rounded-full object-cover" />
      <p className="font-semibold text-[#171717]">{title}</p>
      {description && <p className="max-w-sm text-sm leading-6 text-[#706d67]">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
