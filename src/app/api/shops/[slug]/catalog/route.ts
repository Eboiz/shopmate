import type { NextRequest } from "next/server";
import { chatErrors, shopSlugSchema } from "@/lib/chat/request";
import { findShop, loadCatalog } from "@/lib/chat/web-chat";

// GET /api/shops/<slug>/catalog (PB-04): the public product list of one shop.
// Public, no cookie. Read on every request so a stock or price edit shows at once.
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/shops/[slug]/catalog">) {
  const { slug } = await ctx.params;
  if (!shopSlugSchema.safeParse(slug).success) {
    return Response.json({ error: chatErrors.shopNotFound }, { status: 404 });
  }
  try {
    const shop = await findShop(slug);
    if (!shop) return Response.json({ error: chatErrors.shopNotFound }, { status: 404 });
    return Response.json(await loadCatalog(shop), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("web chat: catalog failed", error);
    return Response.json({ error: chatErrors.catalogFailed }, { status: 500 });
  }
}
