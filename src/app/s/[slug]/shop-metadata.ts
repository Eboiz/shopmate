import "server-only";
import type { Metadata } from "next";
import { shopSlugSchema } from "@/lib/chat/request";
import { findShop, productName } from "@/lib/chat/web-chat";

// The browser tab and link preview show the shop (and product) name, not
// "ShopMate". A lookup failure falls back to the site title instead of
// breaking the page.
export async function shopMetadata(slug: string, productId?: string): Promise<Metadata> {
  if (!shopSlugSchema.safeParse(slug).success) return {};
  try {
    const shop = await findShop(slug);
    if (!shop) return {};
    const product = productId ? await productName(shop.id, productId).catch(() => null) : null;
    const title = product ? `${product} · ${shop.name}` : shop.name;
    const description = product
      ? `${product} tại ${shop.name}. Xem size, màu còn hàng và đặt qua chat.`
      : `Sản phẩm của ${shop.name}. Xem size, màu còn hàng và đặt qua chat với shop.`;
    return { title, description, openGraph: { title, description, siteName: shop.name } };
  } catch (error) {
    console.error("shop page: metadata failed", error);
    return {};
  }
}
