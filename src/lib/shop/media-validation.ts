import { z } from "zod";
import { shopContactSchema } from "./contact";
import { isStoragePublicUrl, MAX_PRODUCT_IMAGES } from "./gallery";

// Forms of PB-32 in /admin/products. The photos are uploaded by the owner's
// browser straight to Supabase Storage; the forms only carry their public URLs,
// so each URL must be a file of the right bucket in this project. That keeps
// next/image (Supabase Storage only) able to show every saved photo.

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const BANNER_BUCKET = "shop-banners";

const BAD_IMAGES_FORM = "Danh sách ảnh không đọc được, hãy tải lại trang.";
const BAD_IMAGE = "Có ảnh không phải ảnh tải lên từ trang này. Hãy xóa ảnh đó rồi tải lại.";
const BAD_BANNER = "Ảnh bìa không phải ảnh tải lên từ trang này. Hãy chọn lại ảnh.";

// Contact details plus the banner URL ("" = no banner, the default photo).
export function shopProfileFormSchema(supabaseUrl: string) {
  return shopContactSchema.extend({
    bannerUrl: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .refine((value) => value === null || isStoragePublicUrl(value, supabaseUrl, BANNER_BUCKET), BAD_BANNER),
  });
}

// One product's photo list, in order, as JSON in one field (["https://…", …]).
export function productImagesFormSchema(supabaseUrl: string) {
  return z
    .object({ productId: z.string().min(1), urls: z.string() })
    .transform((input, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.urls);
      } catch {
        ctx.addIssue({ code: "custom", message: BAD_IMAGES_FORM });
        return z.NEVER;
      }
      const urls = z.array(z.string()).safeParse(parsed);
      if (!urls.success) {
        ctx.addIssue({ code: "custom", message: BAD_IMAGES_FORM });
        return z.NEVER;
      }
      if (urls.data.length > MAX_PRODUCT_IMAGES) {
        ctx.addIssue({ code: "custom", message: `Mỗi sản phẩm tối đa ${MAX_PRODUCT_IMAGES} ảnh.` });
        return z.NEVER;
      }
      if (new Set(urls.data).size !== urls.data.length) {
        ctx.addIssue({ code: "custom", message: "Có ảnh bị lặp. Hãy xóa bớt một ảnh." });
        return z.NEVER;
      }
      if (!urls.data.every((url) => isStoragePublicUrl(url, supabaseUrl, PRODUCT_IMAGES_BUCKET))) {
        ctx.addIssue({ code: "custom", message: BAD_IMAGE });
        return z.NEVER;
      }
      return { productId: input.productId, urls: urls.data };
    });
}
