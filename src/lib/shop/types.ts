import { z } from "zod";

export const shopProductSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  price: z.number().int().positive(),
  imageUrl: z.string().nullable(),
  colors: z.array(z.string()),
  sizesInStock: z.array(z.string()),
});

export const shopCatalogSchema = z.object({
  shop: z.object({ name: z.string().min(1) }),
  products: z.array(shopProductSchema),
});

export type ShopProduct = z.infer<typeof shopProductSchema>;
export type ShopCatalog = z.infer<typeof shopCatalogSchema>;
