import type { Metadata } from "next";
import { Suspense } from "react";
import { ShopFront } from "../../shop-front";
import { shopMetadata } from "../../shop-metadata";
import { ProductDetailSkeleton } from "../../shop-skeleton";

type ProductPageProps = PageProps<"/s/[slug]/p/[productId]">;

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug, productId } = await params;
  return shopMetadata(slug, productId);
}

export default function ProductPage({ params }: ProductPageProps) {
  return (
    <Suspense fallback={<ProductDetailSkeleton />}>
      <Product params={params} />
    </Suspense>
  );
}

async function Product({ params }: Pick<ProductPageProps, "params">) {
  const { slug, productId } = await params;
  return <ShopFront slug={slug} detailProductId={productId} />;
}
