"use client";

import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";

// Shown when the catalog can't be read (database down, network), instead of
// Next's default error page (review #8). The menu and top bar stay usable.
export default function ProductsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Sản phẩm</h1>
      <div className="flex flex-col items-start gap-3 rounded-md border border-red-200 p-4">
        <ErrorMessage>Không tải được dữ liệu sản phẩm. Hãy kiểm tra mạng rồi thử lại.</ErrorMessage>
        <Button variant="secondary" onClick={() => retry()}>
          Thử lại
        </Button>
      </div>
    </>
  );
}
