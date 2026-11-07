import { Suspense } from "react";
import { ShopFront } from "../../shop-front";
import { ProductDetailSkeleton } from "../../shop-skeleton";

type ProductPageProps = PageProps<"/s/[slug]/p/[productId]">;

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
