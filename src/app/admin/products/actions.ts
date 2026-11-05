"use server";

import { refresh } from "next/cache";
import type { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/catalog";
import { NOT_ALLOWED, writeErrorMessage } from "@/lib/catalog-write-errors";
import {
  addPairingSchema,
  deletePairingSchema,
  updatePolicySchema,
  updatePriceSchema,
  updateStockSchema,
} from "@/lib/shop-data-validation";
import type { FormState } from "./form-state";

// Server actions for /admin/products (PB-16). They can be called with a direct
// POST, so each one checks the session again. Hiding buttons from staff is only
// for the UI; the owner-only rule is enforced by RLS in the database (PB-00, A4).
// The role check below just gives staff a clear message without a round trip.

type Write = (ctx: StaffContext) => PromiseLike<{
  error: { code?: string } | null;
  data: unknown[] | null;
}>;

async function ownerWrite<S extends z.ZodType>(
  schema: S,
  formData: FormData,
  write: (input: z.output<S>) => Write,
): Promise<FormState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const ctx = await requireStaff();
  if (ctx.role !== "owner") return { error: NOT_ALLOWED };

  const { error, data } = await write(parsed.data)(ctx);
  const message = writeErrorMessage(error, data?.length ?? 0);
  if (message) return { error: message };

  refresh();
  return { error: null };
}

export async function updatePrice(_prev: FormState, formData: FormData) {
  return ownerWrite(updatePriceSchema, formData, ({ productId, price }) => ({ supabase, shopId }) =>
    supabase
      .from("products")
      .update({ price })
      .eq("id", productId)
      .eq("shop_id", shopId)
      .select("id"),
  );
}

export async function updateStock(_prev: FormState, formData: FormData) {
  return ownerWrite(updateStockSchema, formData, ({ variantId, stock }) => ({ supabase, shopId }) =>
    supabase
      .from("variants")
      .update({ stock })
      .eq("id", variantId)
      .eq("shop_id", shopId)
      .select("id"),
  );
}

export async function updatePolicy(_prev: FormState, formData: FormData) {
  return ownerWrite(updatePolicySchema, formData, ({ type, content }) => async ({ supabase, shopId }) => {
    // Not an upsert: `on conflict do update` would also set shop_id and kind,
    // which the column grants (PB-00) don't allow. A shop may have no row yet.
    const updated = await supabase
      .from("policies")
      .update({ content })
      .eq("shop_id", shopId)
      .eq("kind", type)
      .select("kind");
    if (updated.error || updated.data.length > 0) return updated;
    return supabase.from("policies").insert({ shop_id: shopId, kind: type, content }).select("kind");
  });
}

export async function addPairing(_prev: FormState, formData: FormData) {
  return ownerWrite(addPairingSchema, formData, ({ productId1, productId2, reason }) => ({ supabase, shopId }) =>
    supabase
      .from("pairings")
      .insert({ shop_id: shopId, product_a_id: productId1, product_b_id: productId2, reason })
      .select("id"),
  );
}

export async function deletePairing(_prev: FormState, formData: FormData) {
  return ownerWrite(deletePairingSchema, formData, ({ pairingId }) => ({ supabase, shopId }) =>
    supabase.from("pairings").delete().eq("id", pairingId).eq("shop_id", shopId).select("id"),
  );
}
