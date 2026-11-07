import type { Metadata } from "next";
import { Suspense } from "react";
import { ShopFront } from "./shop-front";
import { shopMetadata } from "./shop-metadata";
import { ShopFrontSkeleton } from "./shop-skeleton";

export async function generateMetadata({ params }: PageProps<"/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return shopMetadata(slug);
}

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
