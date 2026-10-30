import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">ShopMate</h1>
      <p className="text-zinc-600">Trợ lý bán hàng AI cho shop thời trang nhỏ.</p>
      <Link href="/admin" className="underline">
        Vào trang quản lý
      </Link>
    </main>
  );
}
