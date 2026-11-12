// How the admin sums up a product's stock (/admin/products, the dashboard).
// One threshold for both, so "Sắp hết hàng: 5" on the dashboard is the same
// 5 rows the products filter shows.
export const LOW_STOCK = 3;

export type StockSummary = { total: number; low: number; out: boolean };

// `low` counts the color/size rows that are running out (0 included), since the
// owner restocks per row, not per product.
export function summarizeStock(variants: { stock: number }[]): StockSummary {
  const total = variants.reduce((sum, variant) => sum + variant.stock, 0);
  return {
    total,
    low: variants.filter((variant) => variant.stock <= LOW_STOCK).length,
    out: variants.length > 0 && total === 0,
  };
}
