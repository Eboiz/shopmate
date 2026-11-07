import { Suspense } from "react";
import { ShopFront } from "../../shop-front";

type ProductPageProps = PageProps<"/s/[slug]/p/[productId]">;

export default function ProductPage({ params }: ProductPageProps) {
  return (
    <Suspense fallback={<p className="p-6 text-center">Đang tải sản phẩm…</p>}>
      <Product params={params} />
    </Suspense>
  );
}

async function Product({ params }: Pick<ProductPageProps, "params">) {
  const { slug, productId } = await params;
  return <ShopFront slug={slug} detailProductId={productId} />;
}
