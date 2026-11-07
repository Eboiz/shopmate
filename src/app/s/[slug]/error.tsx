"use client";

import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";

export default function ShopError({ reset }: { reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <ErrorMessage>Không tải được cửa hàng. Vui lòng thử lại.</ErrorMessage>
      <Button onClick={reset}>Thử lại</Button>
    </main>
  );
}
