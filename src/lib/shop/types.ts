import { z } from "zod";

// One row of a product's size chart: inclusive height and weight ranges.
export const sizeChartRowSchema = z.object({
  size: z.string(),
  heightMinCm: z.number(),
  heightMaxCm: z.number(),
  weightMinKg: z.number(),
  weightMaxKg: z.number(),
});

export const shopProductSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  price: z.number().int().positive(),
  imageUrl: z.string().nullable(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  colors: z.array(z.string()),
  sizesInStock: z.array(z.string()),
  variants: z.array(z.object({ size: z.string(), color: z.string(), stock: z.number().int().min(0) })).optional(),
  sizeChart: z.array(sizeChartRowSchema).optional(),
});

export const shopCatalogSchema = z.object({
  shop: z.object({
    name: z.string().min(1),
    // The shop's own policy text; empty or missing when not filled in yet.
    policies: z.object({ returns: z.string(), shipping: z.string() }).partial().optional(),
  }),
  products: z.array(shopProductSchema),
});

export type SizeChartRow = z.infer<typeof sizeChartRowSchema>;
export type ShopProduct = z.infer<typeof shopProductSchema>;
export type ShopCatalog = z.infer<typeof shopCatalogSchema>;
