// PB-35 learning (Eboiz/Documents#36). PB-35a (#38) owns this contract; drafted
// by PB-35b (#39) on 2026-11-12, pending review by the three contract owners.
//
// PB-35a maps a LearnResult to learned_facts:
//   learn, needsReview false, shop in "auto" mode -> status active
//   learn otherwise                                 -> status pending
//   skip, or learnFromStaffReply throws             -> nothing stored, the gap stays open
import { z } from "zod";
import { idSchema, policyKindSchema } from "./enums";

// data_gaps.reason. product_not_found is PB-36's.
export const gapReasonSchema = z.enum(["policy_not_covered", "not_covered_by_data", "product_not_found"]);

// One recorded question nobody answered (a data_gaps row).
export const gapQuestionSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  reason: gapReasonSchema,
  question: z.string().min(1).max(500),
});

// What get_policy returns today for one kind (null = the shop wrote nothing).
export const policySnapshotSchema = z.object({ kind: policyKindSchema, content: z.string().nullable() });

export const learnInputSchema = z.object({
  // The shopper's message: data only, never a source of the rule.
  question: z.string().max(500),
  staffReply: z.string().min(1).max(2000),
  policies: z.array(policySnapshotSchema),
  // Removed from the rule when present.
  shopperName: z.string().nullable().optional(),
});

// Why a learned rule must wait for the owner even in "auto" mode.
export const reviewReasonSchema = z.enum(["discount", "conflict", "vague", "model"]);
// Why nothing was learned.
export const skipReasonSchema = z.enum(["one_off", "no_rule", "evidence_not_found", "number_mismatch", "invalid_output"]);

export const learnResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("learn"),
    policyKind: policyKindSchema,
    rule: z.string().min(1).max(500),
    // Verbatim from the staff reply (personal details removed).
    evidence: z.string().min(1),
    needsReview: z.boolean(),
    reviewReasons: z.array(reviewReasonSchema),
    // The model's reason, shown to the owner.
    reason: z.string(),
  }),
  z.object({ status: z.literal("skip"), skipReason: skipReasonSchema, reason: z.string() }),
]);

// A topic of unanswered questions with a draft whose facts are all blanks.
export const gapTopicProposalSchema = z.object({
  title: z.string().min(1).max(80),
  policyKind: policyKindSchema,
  questionIds: z.array(idSchema).min(2),
  conversationCount: z.int().min(2),
  sampleQuestions: z.array(z.string()).min(1).max(3),
  draft: z.string().min(1),
});

export type GapReason = z.infer<typeof gapReasonSchema>;
export type GapQuestion = z.infer<typeof gapQuestionSchema>;
export type PolicySnapshot = z.infer<typeof policySnapshotSchema>;
export type LearnInput = z.infer<typeof learnInputSchema>;
export type ReviewReason = z.infer<typeof reviewReasonSchema>;
export type SkipReason = z.infer<typeof skipReasonSchema>;
export type LearnResult = z.infer<typeof learnResultSchema>;
export type GapTopicProposal = z.infer<typeof gapTopicProposalSchema>;

// True while the text still holds a [...] blank: PB-35a keeps "Duyệt" disabled.
export function hasBlank(text: string): boolean {
  return /\[[^\]]*\]/.test(text);
}
