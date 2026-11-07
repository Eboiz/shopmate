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
    <label className="flex flex-col gap-2 text-sm font-medium text-[#474640]">
      {label}
      <input
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`ui-field min-h-11 px-3 py-2 text-base aria-invalid:border-red-600 ${className}`}
        {...props}
      />
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </label>
  );
}
