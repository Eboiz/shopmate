export type OrderItem = { variantId: string; quantity: number };

// One line per variant: repeats are added up, in the order they first appear.
export function mergeItems(items: OrderItem[]): OrderItem[] {
  const merged = new Map<string, number>();
  for (const { variantId, quantity } of items) merged.set(variantId, (merged.get(variantId) ?? 0) + quantity);
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}
