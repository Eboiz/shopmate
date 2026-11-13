import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ShopFront } from "@/app/s/[slug]/shop-front";
import { previewCatalog } from "./preview-catalog";

export default function ShopPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  // ShopFront reads the filters from the URL (useSearchParams).
  return <Suspense><ShopFront slug="preview" previewCatalog={previewCatalog} /></Suspense>;
}
