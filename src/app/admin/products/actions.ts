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
  updatePolicySchema,
  updatePriceSchema,
  updateStockSchema,
} from "@/lib/shop-data-validation";
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

export async function updatePrice(_prev: FormState, formData: FormData) {
  return ownerWrite(updatePriceSchema, formData, ({ productId, price }) => (db, shopId) =>
    db.from("products").update({ price }).eq("id", productId).eq("shop_id", shopId).select("id"),
  );
}

export async function updateStock(_prev: FormState, formData: FormData) {
  return ownerWrite(updateStockSchema, formData, ({ variantId, stock }) => (db, shopId) =>
    db.from("variants").update({ stock }).eq("id", variantId).eq("shop_id", shopId).select("id"),
  );
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
