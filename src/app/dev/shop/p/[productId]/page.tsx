import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ShopFront } from "@/app/s/[slug]/shop-front";
import { previewCatalog } from "../../preview-catalog";

type PreviewProductProps = PageProps<"/dev/shop/p/[productId]">;

export default function PreviewProductPage({ params }: PreviewProductProps) {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <Suspense fallback={<p className="p-6 text-center">Đang tải sản phẩm…</p>}>
      <PreviewProduct params={params} />
    </Suspense>
  );
}

async function PreviewProduct({ params }: Pick<PreviewProductProps, "params">) {
  const { productId } = await params;
  return <ShopFront slug="preview" previewCatalog={previewCatalog} detailProductId={productId} />;
}
