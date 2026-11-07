"use client";

import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";

export default function ShopError({ reset }: { reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="ui-card flex w-full max-w-md flex-col items-center gap-5 p-8 text-center">
        <span aria-hidden="true" className="text-4xl text-[#e9573f]">✳</span>
        <h1 className="ui-page-title">Chưa mở được cửa hàng</h1>
        <ErrorMessage>Vui lòng kiểm tra kết nối rồi thử lại.</ErrorMessage>
        <Button onClick={reset}>Thử lại</Button>
      </div>
    </main>
  );
}
