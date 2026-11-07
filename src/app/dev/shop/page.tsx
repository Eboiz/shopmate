import { notFound } from "next/navigation";
import { ShopFront } from "@/app/s/[slug]/shop-front";
import { previewCatalog } from "./preview-catalog";

export default function ShopPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ShopFront slug="preview" previewCatalog={previewCatalog} />;
}
