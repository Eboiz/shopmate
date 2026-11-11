import type { ComponentProps, ReactNode } from "react";
import { Spinner } from "./skeleton";

const VARIANTS = {
  primary: "bg-[#171717] text-white hover:bg-[#c2412b]",
  secondary: "border border-[#d5d0c8] bg-white text-[#171717] hover:border-[#171717] hover:bg-[#f5f3ef]",
  danger: "bg-[#c94332] text-white hover:bg-[#a53023]",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
  // While true the button is disabled, shows a spinner and says it is busy.
  loading?: boolean;
  // Replaces the label while loading ("Đang lưu…"); without it the label stays.
  loadingText?: ReactNode;
};

export function Button({
  variant = "primary",
  type = "button",
  className = "",
  loading = false,
  loadingText,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
