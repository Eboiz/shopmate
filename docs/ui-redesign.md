# ShopMate UI direction

This is the local implementation guide for the current UI refresh. Starting points from Figma's public galleries are the [eCommerce Design Website Mockup](https://www.figma.com/community/file/1252561852327562039) for the customer-facing layout and [Horizon UI admin dashboard](https://www.figma.com/community/file/1098131983383434513/horizon-ui-trendiest-open-source-admin-template-dashboard/) for the admin layout. [NOWSAIGON](https://nowsaigon.com/) is an additional reference for editorial typography, prominent navigation, dense product browsing, and quick product actions. These are visual references; no layout, image, logo, or code was copied. The Figma canvases have not been inspected because the workspace does not have a connected Figma account.

## Visual language

- Off-white background `#f5f3ef`, black primary `#171717`, orange accent `#e9573f`, white surfaces, and neutral borders `#e3dfd8`.
- Be Vietnam Pro is self-hosted through Next.js in weights 400–900, so Vietnamese labels and headlines use the same face throughout the interface. The font files and SIL Open Font License are in `src/app/fonts/`.
- Editorial headings, high-contrast controls, restrained cards, and 44px minimum interactive targets.
- Shopfront: photographic hero (real product photo when available, original abstract fabric image otherwise), moving message strip, product search/sort, hover lift, and floating chat. Product cards open a dedicated detail page; the page shows only catalog fields supplied by the shop and keeps chat as an explicit action.
- Admin: responsive dark desktop sidebar, four-item mobile navigation, live dashboard, and work surfaces for inbox, orders, and products.
- Animation respects `prefers-reduced-motion`. Product photos always come from shop data. The original fallback photo `public/hero-texture.png` depicts abstract fabric, not a product for sale.

## Routes covered

| Area | Routes |
| --- | --- |
| Public | `/`, `/s/[slug]`, `/s/[slug]/p/[productId]`, `/login` |
| Admin | `/admin`, `/admin/inbox`, `/admin/orders`, `/admin/products` (all tabs) |
| Local previews | `/dev/shop`, `/dev/shop/p/[productId]`, `/dev/dashboard`, `/dev/login` (development only) |

Preview pages are visual fixtures backed by the demo seed product fields. They do not prove live Supabase or AI integration. The public shop and chat use the `/api/shops/[slug]/catalog` and `/api/shops/[slug]/chat` routes now present on main. The catalog API currently returns the product name, price, image, available colors and sizes; category, description, and per-variant stock shown in the preview require those fields from the API before they can appear on the live detail page. Dashboard figures in the local preview are sample data; the real dashboard loads current inbox and draft orders and shows an unavailable state if either source fails. Review desktop and mobile previews before merging this design direction.
