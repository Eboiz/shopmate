"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { idSchema, policyKindSchema, type PolicyKind } from "@/contract";
import { requireStaff, type StaffProfile } from "@/lib/auth";
import { NOT_ALLOWED, NOT_FOUND, SAVE_FAILED } from "@/lib/catalog-write-errors";
import { createDefaultModel } from "@/lib/engine/anthropic-model";
import { analyzeGaps } from "@/lib/learning";
import * as decide from "@/lib/learning/decide";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "../products/form-state";
import { gapWindowStart, LEARNABLE_GAP_REASONS } from "@/lib/engine/data-gap";

// Server actions for /admin/ai-da-hoc (PB-35a). They can be called with a direct
// POST, so each one reads the session again and uses its shop and user, never
// the form's. RLS (owner only) guards the updates; the role check gives staff a
// clear message without a round trip. approveTopic inserts with the secret key
// and draftTopics writes nothing, so for those two the role check is the guard.

const DRAFT_FAILED = "Chưa soạn được, thử lại";
const BLANK_LEFT = "Còn chỗ trống trong ngoặc vuông. Thay bằng câu trả lời thật của shop rồi duyệt.";

const textSchema = z.string().trim().min(1, "Hãy nhập nội dung.").max(500, "Tối đa 500 ký tự.");
const gapIdsSchema = z.string().transform((ids) => ids.split(",")).pipe(z.array(idSchema).min(1));
const factSchema = z.object({ factId: idSchema });
const editSchema = z.object({ factId: idSchema, text: textSchema });
const modeSchema = z.object({ mode: z.enum(["auto", "review"]) });
const gapsSchema = z.object({ gapIds: gapIdsSchema });
const topicSchema = z.object({ gapIds: gapIdsSchema, policyKind: policyKindSchema, text: textSchema });

// Runs one owner decision; `run` returns an error message or null.
async function ownerDecide<S extends z.ZodType>(
  schema: S,
  formData: FormData,
  run: (input: z.output<S>, who: StaffProfile) => Promise<string | null>,
): Promise<FormState> {
  const values = Object.fromEntries(
    [...formData].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const fail = (error: string): FormState => ({ error, values });

  const parsed = schema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const who = await requireStaff();
  if (who.role !== "owner") return fail(NOT_ALLOWED);

  try {
    const error = await run(parsed.data, who);
    if (error) return fail(error);
  } catch (error) {
    console.error(error);
    return fail(SAVE_FAILED);
  }
  refresh();
  return { error: null };
}

const found = (ok: boolean | number) => (ok ? null : NOT_FOUND);

export async function removeLearned(_prev: FormState, formData: FormData) {
  return ownerDecide(factSchema, formData, async ({ factId }, { shopId, userId }) =>
    found(await decide.removeFact(await createClient(), { shopId, factId, userId })),
  );
}

export async function approveLearned(_prev: FormState, formData: FormData) {
  return ownerDecide(factSchema, formData, async ({ factId }, { shopId, userId }) =>
    found(await decide.approveFact(await createClient(), { shopId, factId, userId })),
  );
}

export async function editLearned(_prev: FormState, formData: FormData) {
  return ownerDecide(editSchema, formData, async ({ factId, text }, { shopId, userId }) =>
    found(await decide.editFact(await createClient(), { shopId, factId, userId, text })),
  );
}

export async function changeLearningMode(_prev: FormState, formData: FormData) {
  return ownerDecide(modeSchema, formData, async ({ mode }, { shopId }) =>
    found(await decide.setLearningMode(await createClient(), shopId, mode)),
  );
}

// "Bỏ qua" on a topic and "Đã xem" on an item the shop doesn't sell.
export async function dismissQuestions(_prev: FormState, formData: FormData) {
  return ownerDecide(gapsSchema, formData, async ({ gapIds }, { shopId }) =>
    found(await decide.dismissGaps(await createClient(), shopId, gapIds)),
  );
}

export async function approveTopic(_prev: FormState, formData: FormData) {
  return ownerDecide(topicSchema, formData, async ({ gapIds, policyKind, text }, { shopId, userId }) => {
    const result = await decide.insertFromDraft(createAdminClient(), { shopId, userId, gapIds, policyKind, text });
    if (result === "blank") return BLANK_LEFT;
    if (result === "no_questions") return NOT_FOUND;
    return null;
  });
}

export type DraftTopic = {
  title: string;
  policyKind: PolicyKind;
  // Only the open questions: approving or dismissing never touches learned ones.
  openIds: string[];
  conversationCount: number;
  sampleQuestions: string[];
  draft: string;
  // The topic also holds questions already learned: the answer wasn't enough.
  askedAgain: boolean;
};

export type DraftResult = { ok: true; topics: DraftTopic[] } | { ok: false; error: string };

// "Soạn câu trả lời": groups the last 7 days' questions into topics with a draft.
// Learned questions go in too, so a topic shows when customers still ask after
// the shop answered. Topics are not stored.
export async function draftTopics(): Promise<DraftResult> {
  const { shopId, role } = await requireStaff();
  if (role !== "owner") return { ok: false, error: NOT_ALLOWED };

  try {
    const { data, error } = await (await createClient())
      .from("data_gaps")
      .select("id, conversation_id, reason, question, status")
      .eq("shop_id", shopId)
      .in("reason", LEARNABLE_GAP_REASONS)
      .is("product_id", null) // a product detail is learned from staff into its description, never drafted as a policy
      .in("status", ["open", "learned"])
      .gte("created_at", gapWindowStart())
      .order("created_at", { ascending: false });
    if (error) throw new Error(`data_gaps: ${error.message}`);
    if (!data.some((gap) => gap.status === "open")) return { ok: true, topics: [] };

    const status = new Map(data.map((gap) => [gap.id, gap.status]));
    const proposals = await analyzeGaps(
      data.map((gap) => ({ id: gap.id, conversationId: gap.conversation_id, reason: gap.reason, question: gap.question })),
      { model: createDefaultModel() },
    );
    const topics = proposals.flatMap(({ questionIds, ...topic }) => {
      const openIds = questionIds.filter((id) => status.get(id) === "open");
      if (openIds.length === 0) return [];
      const askedAgain = questionIds.some((id) => status.get(id) === "learned");
      return [{ ...topic, openIds, askedAgain }];
    });
    return { ok: true, topics };
  } catch (error) {
    console.error(error);
    return { ok: false, error: DRAFT_FAILED };
  }
}
