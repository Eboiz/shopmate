import { z } from "zod";
import { policyKindSchema, type PolicyKind } from "@/contract";

// Parses form text instead of using z.coerce, which would turn an empty field into 0.
const wholeNumber = (message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, message)
    .transform(Number)
    .refine(Number.isSafeInteger, message);

const id = z.string().min(1);

export const POLICY_LABELS: Record<PolicyKind, string> = {
  doi_tra: "Đổi trả",
  giao_hang: "Giao hàng",
  khuyen_mai: "Khuyến mãi",
};

export const POLICY_KINDS = policyKindSchema.options;

const PRICE_ERROR = "Giá phải là số nguyên lớn hơn 0, ví dụ 350000";
// Same cap as products.price in the database (PB-00).
export const MAX_PRICE = 99_999_999;

export const updatePriceSchema = z.object({
  productId: id,
  price: wholeNumber(PRICE_ERROR)
    .refine((price) => price > 0, PRICE_ERROR)
    .refine((price) => price <= MAX_PRICE, "Giá phải nhỏ hơn 100.000.000 đồng"),
});

// Far below the database's integer limit, and more than a small shop holds of
// one size and color: a longer number is a typo.
export const MAX_STOCK = 99_999;

export const updateStockSchema = z.object({
  variantId: id,
  stock: wholeNumber("Tồn kho phải là số nguyên từ 0 trở lên").refine(
    (stock) => stock <= MAX_STOCK,
    "Tồn kho tối đa là 99.999",
  ),
});

// Empty content is allowed: it means the shop has no such policy, so the AI hands
// that question to staff (PB-02).
export const updatePolicySchema = z.object({
  type: policyKindSchema,
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
