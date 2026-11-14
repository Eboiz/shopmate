import { describe, expect, it } from "vitest";
import {
  addImage,
  cardImage,
  fitWithin,
  galleryAlt,
  galleryKeyTarget,
  isStoragePublicUrl,
  MAX_PRODUCT_IMAGES,
  moveImage,
  productGallery,
  removeImage,
} from "./gallery";

const SUPABASE = "https://abc.supabase.co";
const photo = (name: string) => `${SUPABASE}/storage/v1/object/public/product-images/shop-a/p1/${name}.webp`;

describe("productGallery", () => {
  it("orders product_images by position, whatever order the rows come in", () => {
    expect(productGallery("seed.jpg", [{ url: "b", position: 1 }, { url: "c", position: 2 }, { url: "a", position: 0 }])).toEqual(["a", "b", "c"]);
  });

  it("keeps image_url as the only photo when the product has no rows", () => {
    expect(productGallery("seed.jpg", [])).toEqual(["seed.jpg"]);
    expect(productGallery("seed.jpg", undefined)).toEqual(["seed.jpg"]);
  });

  it("has no photo when there is neither", () => {
    expect(productGallery(null, [])).toEqual([]);
  });

  it("drops a repeated URL", () => {
    expect(productGallery(null, [{ url: "a", position: 0 }, { url: "a", position: 1 }])).toEqual(["a"]);
  });
});

describe("cardImage", () => {
  it("is the first photo, else image_url", () => {
    expect(cardImage(["a", "b"], "seed.jpg")).toBe("a");
    expect(cardImage([], "seed.jpg")).toBe("seed.jpg");
    expect(cardImage(undefined, null)).toBeNull();
  });
});

describe("editor steps", () => {
  it("adds at the end, skips a duplicate and stops at the cap", () => {
    expect(addImage(["a"], "b")).toEqual(["a", "b"]);
    expect(addImage(["a"], "a")).toEqual(["a"]);
    const full = Array.from({ length: MAX_PRODUCT_IMAGES }, (_, i) => `p${i}`);
    expect(addImage(full, "new")).toEqual(full);
  });

  it("removes by index", () => {
    expect(removeImage(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removeImage(["a"], 5)).toEqual(["a"]);
  });

  it("moves a photo up or down, and ignores moves past either end", () => {
    expect(moveImage(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveImage(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveImage(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveImage(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("does not change the list it was given", () => {
    const list = ["a", "b"];
    moveImage(list, 0, 1);
    removeImage(list, 0);
    addImage(list, "c");
    expect(list).toEqual(["a", "b"]);
  });
});

describe("galleryKeyTarget", () => {
  it("moves with arrows, wraps around, and jumps with Home/End", () => {
    expect(galleryKeyTarget("ArrowRight", 0, 3)).toBe(1);
    expect(galleryKeyTarget("ArrowRight", 2, 3)).toBe(0);
    expect(galleryKeyTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(galleryKeyTarget("Home", 2, 3)).toBe(0);
    expect(galleryKeyTarget("End", 0, 3)).toBe(2);
    expect(galleryKeyTarget("Enter", 0, 3)).toBeNull();
    expect(galleryKeyTarget("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("galleryAlt", () => {
  it("uses the product name, numbered when there are several photos", () => {
    expect(galleryAlt("Váy suông linen", 0, 1)).toBe("Váy suông linen");
    expect(galleryAlt("Váy suông linen", 1, 3)).toBe("Váy suông linen – ảnh 2/3");
  });
});

describe("fitWithin", () => {
  it("shrinks the long side to the limit and keeps the ratio", () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600, 1200)).toEqual({ width: 800, height: 600 });
  });
});

describe("isStoragePublicUrl", () => {
  it("accepts a public file of the bucket in this project", () => {
    expect(isStoragePublicUrl(photo("1"), SUPABASE, "product-images")).toBe(true);
    expect(isStoragePublicUrl(photo("1"), SUPABASE, "product-images", "shop-a")).toBe(true);
    // The seed stores its photos at the bucket root.
    expect(isStoragePublicUrl(`${SUPABASE}/storage/v1/object/public/product-images/SP01.jpg`, SUPABASE, "product-images")).toBe(true);
  });

  it("refuses another host, bucket, folder, path tricks and non-URLs", () => {
    expect(isStoragePublicUrl("https://evil.example/storage/v1/object/public/product-images/a.jpg", SUPABASE, "product-images")).toBe(false);
    expect(isStoragePublicUrl(photo("1"), SUPABASE, "shop-banners")).toBe(false);
    expect(isStoragePublicUrl(photo("1"), SUPABASE, "product-images", "shop-b")).toBe(false);
    expect(isStoragePublicUrl(`${SUPABASE}/storage/v1/object/public/product-images/`, SUPABASE, "product-images")).toBe(false);
    expect(isStoragePublicUrl(`${SUPABASE}/storage/v1/object/public/product-images/a.jpg?x=1`, SUPABASE, "product-images")).toBe(false);
    expect(isStoragePublicUrl("not a url", SUPABASE, "product-images")).toBe(false);
  });
});
