// Vietnamese text helpers for matching what shoppers type against shop data.

// "Váy Suông LINEN " -> "vay suong linen". đ is its own letter, not d + a mark,
// so NFD leaves it alone and it is mapped by hand.
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

const LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

// Letter sizes in their usual order, then other sizes: numbers by value, the
// rest alphabetically. Repeats are removed.
export function sortSizes(sizes: string[]): string[] {
  const rank = (s: string) => {
    const i = LETTER_SIZES.indexOf(s.toUpperCase());
    return i >= 0 ? i : LETTER_SIZES.length;
  };
  const isNumber = (s: string) => /^\d+(\.\d+)?$/.test(s);
  return [...new Set(sizes)].sort((x, y) => {
    const byRank = rank(x) - rank(y);
    if (byRank !== 0) return byRank;
    if (rank(x) < LETTER_SIZES.length) return 0;
    if (isNumber(x) && isNumber(y)) return Number(x) - Number(y);
    if (isNumber(x) !== isNumber(y)) return isNumber(x) ? -1 : 1;
    return x.localeCompare(y);
  });
}
