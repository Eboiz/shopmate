import { Suspense } from "react";
import { ShopFront } from "./shop-front";
import { ShopFrontSkeleton } from "./shop-skeleton";

async function Shop({ params }: { params: PageProps<"/s/[slug]">["params"] }) {
  const { slug } = await params;
  return <ShopFront slug={slug} />;
}

export default function ShopPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <Suspense fallback={<ShopFrontSkeleton />}>
      <Shop params={params} />
    </Suspense>
  );
}
