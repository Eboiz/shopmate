// Clothing sizes in the order a shop owner reads them, not alphabetical
// (alphabetical puts L before M before S). Unknown sizes, such as numbers,
// come after, in natural order.
const SIZE_RANK = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

export function compareSizes(a: string, b: string): number {
  const rankA = SIZE_RANK.indexOf(a.trim().toUpperCase());
  const rankB = SIZE_RANK.indexOf(b.trim().toUpperCase());
  if (rankA !== -1 || rankB !== -1) {
    if (rankA === -1) return 1;
    if (rankB === -1) return -1;
    return rankA - rankB;
  }
  return a.localeCompare(b, "vi", { numeric: true });
}
