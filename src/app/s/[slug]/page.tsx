import { Suspense } from "react";
import { ShopFront } from "./shop-front";

async function Shop({ params }: { params: PageProps<"/s/[slug]">["params"] }) {
  const { slug } = await params;
  return <ShopFront slug={slug} />;
}

export default function ShopPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <Suspense fallback={<p className="p-6 text-center">Đang tải cửa hàng…</p>}>
      <Shop params={params} />
    </Suspense>
  );
}
