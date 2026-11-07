"use client";

import { useActionState, useState } from "react";
import { signIn, type LoginState } from "./actions";
import { Icon } from "@/components/ui/icon";
import { LoadingRegion, Skeleton, Spinner } from "@/components/ui/skeleton";

const initialState: LoginState = { error: null };

export function LoginForm({ next, preview = false }: { next: string; preview?: boolean }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-2 text-sm font-semibold text-[#474640]">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="email@cuahang.vn"
          className="ui-field min-h-12 px-4 py-2 text-base"
        />
      </label>
      <div className="flex flex-col gap-2 text-sm font-semibold text-[#474640]"><label htmlFor="login-password">Mật khẩu</label><div className="relative"><input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="Nhập mật khẩu" className="ui-field min-h-12 w-full px-4 py-2 pr-16 text-base" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 min-w-14 px-3 text-xs font-semibold text-[#706d67] hover:text-[#171717]" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPassword ? "Ẩn" : "Hiện"}</button></div></div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-[#fff0eb] px-3 py-2 text-sm text-[#b2382a]">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || preview}
        aria-busy={pending || undefined}
        className="mt-2 flex min-h-12 items-center justify-center gap-3 rounded-lg bg-[#171717] px-4 py-2 font-semibold text-white transition-colors hover:bg-[#e9573f] disabled:opacity-60"
      >
        {pending ? <Spinner /> : <Icon name="login" className="size-4" />}{preview ? "Bản xem thử giao diện" : pending ? "Đang đăng nhập..." : "Đăng nhập"}
      </button>
    </form>
  );
}

// The form's frame while the page reads ?next=, so the card doesn't jump.
export function LoginFormSkeleton() {
  return (
    <LoadingRegion label="Đang tải biểu mẫu đăng nhập…" className="flex flex-col gap-5">
      {[0, 1].map((field) => (
        <div key={field} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ))}
      <Skeleton className="mt-2 h-12 w-full rounded-lg" />
    </LoadingRegion>
  );
}
