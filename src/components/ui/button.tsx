import type { ComponentProps } from "react";

const VARIANTS = {
  primary: "bg-zinc-900 text-white",
  secondary: "border border-zinc-300 bg-white text-zinc-900",
  danger: "bg-red-600 text-white",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
};

export function Button({
  variant = "primary",
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`min-h-11 rounded-md px-4 py-2 disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
