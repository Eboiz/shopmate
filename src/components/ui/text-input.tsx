import { useId, type ComponentProps } from "react";
import { ErrorMessage } from "./error-message";

type TextInputProps = ComponentProps<"input"> & {
  label: string;
  error?: string | null;
};

// text-base keeps iOS Safari from zooming in when the field gets focus.
export function TextInput({ label, error, className = "", ...props }: TextInputProps) {
  const errorId = useId();

  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-base aria-invalid:border-red-600 ${className}`}
        {...props}
      />
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </label>
  );
}
