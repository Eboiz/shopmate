import type { ComponentProps, ReactNode } from "react";

// Loading placeholders shared by every page. Server-safe (no hooks), so both
// loading.tsx files and client components can use them.

// A grey block with the shape of content that is still on its way. Hidden from
// screen readers: the LoadingRegion around it says what is loading.
export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
  // Two rounded-* classes on one element have no guaranteed winner in Tailwind,
  // so the default radius only applies when the caller gives none.
  const radius = /(^|\s)rounded/.test(className) ? "" : "rounded-md";
  return <div aria-hidden="true" className={`animate-pulse bg-[#e6e1d8] ${radius} ${className}`} {...props} />;
}

// Wraps skeletons so assistive tech hears `label` once instead of nothing.
export function LoadingRegion({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

// A small spinning ring in the current text color, for buttons and inline waits.
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

// Page header placeholder matching the eyebrow + title + subtitle of admin pages.
export function PageHeaderSkeleton() {
  return (
    <div className="mb-7 space-y-3">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

// Chat bubbles alternating left and right, for message logs that are loading.
export function ChatSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={`flex ${index % 2 ? "justify-end" : ""}`}>
          <div className="w-3/4 space-y-2">
            <Skeleton className={`h-3 w-16 ${index % 2 ? "ml-auto" : ""}`} />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Three dots that bounce in turn: "someone is typing".
export function TypingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}
