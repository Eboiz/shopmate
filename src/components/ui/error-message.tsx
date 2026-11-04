import type { ComponentProps } from "react";

export function ErrorMessage({ className = "", ...props }: ComponentProps<"p">) {
  return <p role="alert" className={`text-sm text-red-600 ${className}`} {...props} />;
}
