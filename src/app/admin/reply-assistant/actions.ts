"use server";

import { z } from "zod";
import type { EngineOutput } from "@/contract";
import { requireStaff } from "@/lib/auth";
import { runStaffDraft } from "@/lib/engine/run";
import { staffDraftLimitReached } from "@/lib/guard/staff-draft-limit";

// PB-20 (AI-04, AI-assisted): a draft reply for a question staff paste from Zalo,
// Facebook or the counter. Nothing is sent: staff edit and copy the draft.
//
// The engine runs in staff_draft mode for the signed-in staff member's shop
// (runStaffDraft resolves it from the profile; nothing shop-related comes from
// the client): read tools and the number check only, no orders, no handoff. A
// complaint comes back as personalReplyNeeded, decided before any model call.

// Same cap as a reply (PB-00); a pasted chat longer than that is not one question.
const questionSchema = z.string().trim().min(1).max(1000);

export async function generateStaffDraft(question: string): Promise<EngineOutput> {
  const { shopId } = await requireStaff();

  const parsed = questionSchema.safeParse(question);
  if (!parsed.success) throw new Error("invalid_question");

  if (await staffDraftLimitReached(shopId)) throw new Error("draft_limit_reached");

  return runStaffDraft({ mode: "staff_draft", history: [{ sender: "shopper", text: parsed.data }] });
}
