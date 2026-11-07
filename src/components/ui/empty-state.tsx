import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#d5d0c8] bg-white px-6 py-12 text-center">
      <span aria-hidden="true" className="mb-1 flex size-12 items-center justify-center rounded-full bg-[#efebe4] text-2xl text-[#e9573f]">✳</span>
      <p className="font-semibold text-[#171717]">{title}</p>
      {description && <p className="max-w-sm text-sm leading-6 text-[#706d67]">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
