import { useId, type ComponentProps } from "react";
import { ErrorMessage } from "./error-message";

type TextAreaProps = ComponentProps<"textarea"> & {
  label: string;
  error?: string | null;
};

export function TextArea({ label, error, className = "", ...props }: TextAreaProps) {
  const errorId = useId();

  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <textarea
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`rounded-md border border-zinc-300 px-3 py-2 text-base aria-invalid:border-red-600 ${className}`}
        {...props}
      />
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </label>
  );
}
