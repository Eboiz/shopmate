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

const priceField = wholeNumber(PRICE_ERROR)
  .refine((price) => price > 0, PRICE_ERROR)
  .refine((price) => price <= MAX_PRICE, "Giá phải nhỏ hơn 100.000.000 đồng");

export const updatePriceSchema = z.object({ productId: id, price: priceField });

// Far below the database's integer limit, and more than a small shop holds of
// one size and color: a longer number is a typo.
export const MAX_STOCK = 99_999;

const stockField = wholeNumber("Tồn kho phải là số nguyên từ 0 trở lên").refine(
  (stock) => stock <= MAX_STOCK,
  "Tồn kho tối đa là 99.999",
);

export const updateStockSchema = z.object({ variantId: id, stock: stockField });

// The same rules for the editor, to mark a field before anything is sent.
export const priceError = (text: string) => priceField.safeParse(text).error?.issues[0].message ?? null;
export const stockError = (text: string) => stockField.safeParse(text).error?.issues[0].message ?? null;

const BAD_PRODUCT_FORM = "Dữ liệu tồn kho không đọc được, hãy tải lại trang.";

// One save per product: the price and every color/size row together, so the
// owner presses one button instead of one per field. The stock rows come as
// JSON in one field ([{ variantId, stock }]), as typed.
export const saveProductSchema = z
  .object({ productId: id, price: priceField, stocks: z.string() })
  .transform((input, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.stocks);
    } catch {
      ctx.addIssue({ code: "custom", message: BAD_PRODUCT_FORM });
      return z.NEVER;
    }
    const rows = z.array(z.object({ variantId: id, stock: z.string() })).safeParse(parsed);
    if (!rows.success) {
      ctx.addIssue({ code: "custom", message: BAD_PRODUCT_FORM });
      return z.NEVER;
    }
    const stocks: { variantId: string; stock: number }[] = [];
    for (const row of rows.data) {
      const stock = stockField.safeParse(row.stock);
      if (!stock.success) {
        ctx.addIssue({ code: "custom", message: stock.error.issues[0].message });
        return z.NEVER;
      }
      stocks.push({ variantId: row.variantId, stock: stock.data });
    }
    return { productId: input.productId, price: input.price, stocks };
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
