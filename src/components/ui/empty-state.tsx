import Image from "next/image";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  // Admin screens show what is empty (a chat, a box), not a product photo.
  icon?: IconName;
};

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#d5d0c8] bg-white px-6 py-12 text-center">
      {icon ? (
        <span className="mb-1 flex size-14 items-center justify-center rounded-full bg-[#efebe4] text-[#474640]"><Icon name={icon} className="size-6" /></span>
      ) : (
        <Image src="/images/product-placeholder.jpg" alt="" width={64} height={64} className="mb-1 size-16 rounded-full object-cover" />
      )}
      <p className="font-semibold text-[#171717]">{title}</p>
      {description && <p className="max-w-sm text-sm leading-6 text-[#706d67]">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
