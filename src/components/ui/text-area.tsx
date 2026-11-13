import { useId, type ComponentProps } from "react";
import { ErrorMessage } from "./error-message";

type TextAreaProps = ComponentProps<"textarea"> & {
  label: string;
  error?: string | null;
};

export function TextArea({ label, error, className = "", ...props }: TextAreaProps) {
  const errorId = useId();

  return (
    <label className="flex flex-col gap-2 text-sm font-medium text-[#474640]">
      {label}
      <textarea
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`ui-field px-3 py-2 text-base aria-invalid:border-[#b2382a] ${className}`}
        {...props}
      />
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </label>
  );
}
