import { Suspense } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { safeNextPath } from "@/lib/auth-routes";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <LoginScreen><Suspense><LoginFormWithNext searchParams={searchParams} /></Suspense></LoginScreen>
  );
}

export function LoginScreen({ children }: { children: ReactNode }) {
  return <main className="flex w-full flex-1 items-center justify-center bg-[#f5f3ef] px-4 py-8 sm:px-6 lg:py-12"><div className="grid w-full max-w-6xl overflow-hidden rounded-xl border border-[#e3dfd8] bg-white shadow-[0_28px_80px_-48px_#17171777] lg:grid-cols-2"><div className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden bg-[#171717] p-10 text-white lg:flex lg:p-12"><div aria-hidden="true" className="absolute -right-24 top-20 size-96 rotate-[-20deg] rounded-full border-[36px] border-[#ffffff14]" /><div aria-hidden="true" className="absolute -bottom-32 -left-32 size-[30rem] rounded-full bg-[#e9573f] opacity-75 blur-[100px]" /><Link href="/" className="relative text-2xl font-black tracking-[-.06em]">ShopMate<span className="text-[#e9573f]">.</span></Link><div className="ui-enter relative"><p className="mb-5 text-xs font-bold uppercase tracking-[.22em] text-[#ff8d75]">Your store. Your rhythm.</p><h2 className="text-[clamp(3.5rem,5vw,5.5rem)] font-black uppercase leading-[.94] tracking-[-.085em]">Sell.<br />Connect.<br /><span className="text-[#e9573f]">Grow.</span></h2><p className="mt-7 max-w-sm text-sm leading-7 text-[#c6c2bb]">Tin nhắn, đơn hàng và sản phẩm trong một không gian rõ ràng để bạn tập trung vào khách hàng.</p></div><p className="relative text-xs uppercase tracking-[.16em] text-[#918e87]">ShopMate / Studio access</p></div><div className="flex min-h-[560px] flex-col justify-center p-7 sm:p-12 lg:p-14"><Link href="/" className="mb-12 text-xl font-black tracking-[-.06em] lg:hidden">ShopMate<span className="text-[#e9573f]">.</span></Link><p className="ui-eyebrow mb-3">Chào mừng trở lại</p><h1 className="ui-page-title mb-3">Đăng nhập<span className="text-[#e9573f]">.</span></h1><p className="mb-9 text-sm leading-6 text-[#706d67]">Đăng nhập để tiếp tục quản lý cửa hàng của bạn.</p>{children}<p className="mt-8 border-t border-[#e3dfd8] pt-5 text-xs text-[#706d67]">ShopMate dành cho chủ shop và nhân viên được cấp quyền.</p></div></div></main>;
}

async function LoginFormWithNext({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(typeof next === "string" ? next : null)} />;
}
