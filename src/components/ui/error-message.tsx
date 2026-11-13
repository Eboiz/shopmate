import type { ComponentProps } from "react";

export function ErrorMessage({ className = "", ...props }: ComponentProps<"p">) {
  return <p role="alert" className={`text-sm text-[#b2382a] ${className}`} {...props} />;
}
