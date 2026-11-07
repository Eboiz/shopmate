"use client";

import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";

// Shown when the catalog can't be read (database down, network), instead of
// Next's default error page (review #8). The menu and top bar stay usable.
export default function ProductsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <h1 className="ui-page-title mb-6">Sản phẩm</h1>
      <div className="ui-card flex flex-col items-start gap-4 p-6">
        <ErrorMessage>Không tải được dữ liệu sản phẩm. Hãy kiểm tra mạng rồi thử lại.</ErrorMessage>
        <Button variant="secondary" onClick={() => retry()}>
          Thử lại
        </Button>
      </div>
    </>
  );
}
