// Product photos (PB-32). Pure functions shared by the catalog API, the product
// editor and the shop page, so the same ordering rules run everywhere and in tests.

// Same cap as product_images.position (0–7) in the database.
export const MAX_PRODUCT_IMAGES = 8;

// The browser shrinks a photo to fit these before uploading, so a 4 MB phone
// photo fits the bucket limits (product-images 200 KB, shop-banners 500 KB).
export const PRODUCT_IMAGE_MAX_SIDE = 1200;
export const PRODUCT_IMAGE_MAX_BYTES = 200_000;
export const BANNER_MAX_SIDE = 1920;
export const BANNER_MAX_BYTES = 500_000;

// The hero photo of the shop page when the owner has not uploaded a banner.
export const DEFAULT_BANNER = "/images/hero-boutique.jpg";

export type ProductImageRow = { url: string; position: number };

// The product's photos in order. Rows of product_images win; a product with
// none still shows its image_url (the seeded photo), and one with neither has
// no photo at all.
export function productGallery(imageUrl: string | null | undefined, rows: readonly ProductImageRow[] | null | undefined): string[] {
  const ordered = (rows ?? []).toSorted((a, b) => a.position - b.position).map((row) => row.url);
  if (ordered.length > 0) return [...new Set(ordered)];
  return imageUrl ? [imageUrl] : [];
}

// The card photo: the first photo of the gallery.
export function cardImage(images: readonly string[] | undefined, imageUrl: string | null): string | null {
  return images?.[0] ?? imageUrl;
}

// Editor steps. Each returns a new list and leaves the input alone.
export function addImage(list: readonly string[], url: string): string[] {
  if (list.includes(url) || list.length >= MAX_PRODUCT_IMAGES) return [...list];
  return [...list, url];
}

export function removeImage(list: readonly string[], index: number): string[] {
  return list.filter((_, i) => i !== index);
}

// Moves the photo at `index` by `delta` places (−1 = earlier); out of range is a no-op.
export function moveImage(list: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// The next index for arrow/Home/End keys in the gallery thumbnails; null for other keys.
export function galleryKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// Alt text from the product name: the first photo is the product itself, the
// others say which one they are.
export function galleryAlt(productName: string, index: number, count: number): string {
  return count <= 1 ? productName : `${productName} – ảnh ${index + 1}/${count}`;
}

// Width and height that fit inside maxSide × maxSide, keeping the ratio; never enlarges.
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// True when `url` is a public file of `bucket` in this app's Supabase project,
// optionally inside `folder`. The editor only saves such URLs, so next/image
// (which allows only Supabase Storage) can always show them.
export function isStoragePublicUrl(url: string, supabaseUrl: string, bucket: string, folder?: string): boolean {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (parsed.origin !== base.origin || parsed.search || parsed.hash) return false;
  const prefix = `/storage/v1/object/public/${bucket}/${folder ? `${folder}/` : ""}`;
  const rest = parsed.pathname.startsWith(prefix) ? parsed.pathname.slice(prefix.length) : "";
  return rest !== "" && !rest.split("/").some((part) => part === "" || part === "." || part === "..");
}
