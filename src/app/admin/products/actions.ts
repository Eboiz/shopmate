"use server";

import { refresh } from "next/cache";
import type { z } from "zod";
import { requireStaff } from "@/lib/auth";
import {
  NOT_ALLOWED,
  PAIRING_EXISTS,
  POLICY_SAVE_FAILED,
  SIZE_EXISTS,
  SIZE_OVERLAP,
  writeErrorMessage,
  type WriteMessages,
} from "@/lib/catalog-write-errors";
import {
  addPairingSchema,
  deletePairingSchema,
  saveProductSchema,
  updatePolicySchema,
} from "@/lib/shop-data-validation";
import { publicEnv } from "@/lib/env";
import { productImagesFormSchema, shopProfileFormSchema } from "@/lib/shop/media-validation";
import { saveSizeChartSchema } from "@/lib/size-chart-validation";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./form-state";

// Server actions for /admin/products (PB-16). They can be called with a direct
// POST, so each one checks the session again. Hiding buttons from staff is only
// for the UI; the owner-only rule is enforced by RLS in the database (PB-00, A4).
// The role check below just gives staff a clear message without a round trip.

type Db = Awaited<ReturnType<typeof createClient>>;
type WriteResult = { error: { code?: string } | null; data: unknown[] | null };
type Write = (db: Db, shopId: string) => PromiseLike<WriteResult>;

async function ownerWrite<S extends z.ZodType>(
  schema: S,
  formData: FormData,
  write: (input: z.output<S>) => Write,
  messages: WriteMessages = {},
): Promise<FormState> {
  const values = Object.fromEntries(
    [...formData].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const fail = (error: string): FormState => ({ error, values });

  const parsed = schema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { shopId, role } = await requireStaff();
  if (role !== "owner") return fail(NOT_ALLOWED);

  const { error, data } = await write(parsed.data)(await createClient(), shopId);
  const message = writeErrorMessage(error, data?.length ?? 0, messages);
  if (message) return fail(message);

  refresh();
  return { error: null };
}

// One product: its price and the stock rows the owner changed. Only changed rows
// are sent, so confirming an order (which lowers stock) while the page is open
// is not undone by saving the price. The writes are separate statements; if one
// fails the owner sees the error, and the page after refresh shows what was saved.
export async function saveProduct(_prev: FormState, formData: FormData) {
  return ownerWrite(saveProductSchema, formData, ({ productId, price, stocks }) => async (db, shopId) => {
    const product = await db.from("products").update({ price }).eq("id", productId).eq("shop_id", shopId).select("id");
    if (product.error || product.data.length === 0) return product;
    const rows = await Promise.all(
      stocks.map(({ variantId, stock }) =>
        db.from("variants").update({ stock }).eq("id", variantId).eq("product_id", productId).eq("shop_id", shopId).select("id"),
      ),
    );
    return rows.find((row) => row.error || row.data.length === 0) ?? product;
  });
}

export async function updatePolicy(_prev: FormState, formData: FormData) {
  return ownerWrite(
    updatePolicySchema,
    formData,
    ({ type, content }) =>
      async (db, shopId) => {
        // Not an upsert: `on conflict do update` would also set shop_id and kind,
        // which the column grants (PB-00) don't allow. A shop may have no row yet.
        const updated = await db
          .from("policies")
          .update({ content })
          .eq("shop_id", shopId)
          .eq("kind", type)
          .select("kind");
        if (updated.error || updated.data.length > 0) return updated;
        return db.from("policies").insert({ shop_id: shopId, kind: type, content }).select("kind");
      },
    { failed: POLICY_SAVE_FAILED },
  );
}

export async function addPairing(_prev: FormState, formData: FormData) {
  return ownerWrite(
    addPairingSchema,
    formData,
    ({ productId1, productId2, reason }) =>
      (db, shopId) =>
        db
          .from("pairings")
          .insert({ shop_id: shopId, product_a_id: productId1, product_b_id: productId2, reason })
          .select("id"),
    { duplicate: PAIRING_EXISTS },
  );
}

export async function deletePairing(_prev: FormState, formData: FormData) {
  return ownerWrite(deletePairingSchema, formData, ({ pairingId }) => (db, shopId) =>
    db.from("pairings").delete().eq("id", pairingId).eq("shop_id", shopId).select("id"),
  );
}

// PB-24: replaces the product's whole chart in one transaction (save_size_chart),
// so moving the boundary between two sizes never trips the overlap constraint
// half way. recommend_size reads size_charts without a cache, so the AI uses the
// new chart for the very next question.
export async function saveSizeChart(_prev: FormState, formData: FormData) {
  return ownerWrite(
    saveSizeChartSchema,
    formData,
    ({ productId, rows }) =>
      async (db) => {
        const { error } = await db.rpc("save_size_chart", {
          p_product_id: productId,
          p_rows: rows.map((row) => ({
            size: row.size,
            height_min_cm: row.heightMin,
            height_max_cm: row.heightMax,
            weight_min_kg: row.weightMin,
            weight_max_kg: row.weightMax,
          })),
        });
        // An empty chart saves zero rows and is still a success.
        return { error, data: error ? null : [productId] };
      },
    { duplicate: SIZE_EXISTS, overlap: SIZE_OVERLAP },
  );
}

// PB-32: the product's photos in order, replaced as a whole (save_product_images),
// so moving a photo never trips unique (product_id, position) half way. The
// first photo also becomes products.image_url, the card photo the AI and the
// chat cards use.
export async function saveProductImages(_prev: FormState, formData: FormData) {
  return ownerWrite(
    productImagesFormSchema(publicEnv().NEXT_PUBLIC_SUPABASE_URL),
    formData,
    ({ productId, urls }) =>
      async (db) => {
        const { error } = await db.rpc("save_product_images", { p_product_id: productId, p_urls: urls });
        // An emptied list saves zero rows and is still a success.
        return { error, data: error ? null : [productId] };
      },
  );
}

// PB-32: address, phone, fanpage and banner of the signed-in owner's shop. RLS
// ("owner updates" on shops) refuses staff and other shops; an update RLS
// hides returns no row, which reads as "not found or not allowed".
export async function saveShopProfile(_prev: FormState, formData: FormData) {
  return ownerWrite(
    shopProfileFormSchema(publicEnv().NEXT_PUBLIC_SUPABASE_URL),
    formData,
    ({ address, phone, fanpageUrl, bannerUrl }) =>
      (db, shopId) =>
        db
          .from("shops")
          .update({ address, phone, fanpage_url: fanpageUrl, banner_url: bannerUrl })
          .eq("id", shopId)
          .select("id"),
  );
}
