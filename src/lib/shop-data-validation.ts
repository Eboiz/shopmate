import { z } from "zod";

// Parses form text instead of using z.coerce, which would turn an empty field into 0.
const wholeNumber = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, message)
    .transform(Number)
    .refine(Number.isSafeInteger, message);

const id = z.string().min(1);

export const POLICY_LABELS = {
  doi_tra: "Đổi trả",
  giao_hang: "Giao hàng",
  khuyen_mai: "Khuyến mãi",
} as const;

export type PolicyType = keyof typeof POLICY_LABELS;

const PRICE_ERROR = "Giá phải là số nguyên lớn hơn 0, ví dụ 350000";

export const updatePriceSchema = z.object({
  productId: id,
  price: wholeNumber(PRICE_ERROR).refine((price) => price > 0, PRICE_ERROR),
});

export const updateStockSchema = z.object({
  variantId: id,
  stock: wholeNumber("Tồn kho phải là số nguyên từ 0 trở lên"),
});

// Empty content is allowed: it means the shop has no such policy, so the AI hands
// that question to staff (PB-02).
export const updatePolicySchema = z.object({
  type: z.enum(["doi_tra", "giao_hang", "khuyen_mai"]),
  content: z.string().trim(),
});

export const addPairingSchema = z
  .object({
    productId1: z.string().min(1, "Hãy chọn đủ 2 sản phẩm"),
    productId2: z.string().min(1, "Hãy chọn đủ 2 sản phẩm"),
    reason: z.string().trim().min(1, "Hãy ghi lý do 2 món hợp nhau"),
  })
  .refine((pairing) => pairing.productId1 !== pairing.productId2, {
    message: "Hãy chọn 2 sản phẩm khác nhau",
  });

export const deletePairingSchema = z.object({ pairingId: id });
