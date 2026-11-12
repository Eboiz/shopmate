// PB-35b: learn a general rule from what a staff member told a shopper. One
// Claude call, no tools, structured output; the model only proposes and the
// checks in checks.ts decide (Eboiz/Documents#39).
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { policyKindSchema, type LearnInput, type LearnResult, type ReviewReason } from "@/contract";
import { DEFAULT_MODEL, type ModelClient } from "@/lib/engine/engine";
import { mentionsOffer } from "@/lib/engine/discount-guard";
import { toStructuredOutputSchema } from "@/lib/engine/model-reply";
import { evidenceInReply, hasOneOffMarker, hasVagueMarker, numbersBacked, redactPersonal, ruleSupported } from "./checks";
import { buildLearnSystemPrompt, buildLearnUserMessage } from "./prompt";

export type LearningDeps = { model: ModelClient; modelName?: string };

// What the model returns, before any check.
export const learnModelOutputSchema = z.object({
  kind: z.enum(["general", "one_off"]),
  policyKind: policyKindSchema,
  rule: z.string(),
  evidence: z.string(),
  conflictsWithPolicy: z.boolean(),
  vague: z.boolean(),
  needsReview: z.boolean(),
  reason: z.string(),
});

const LEARN_JSON_SCHEMA = toStructuredOutputSchema(learnModelOutputSchema);
const MAX_RULE = 500;

export const modelNameFrom = (deps: LearningDeps) => deps.modelName ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

export const textOf = (message: Anthropic.Message) =>
  message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

export function parseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// A model or network error is thrown: PB-35a keeps the gap open.
export async function learnFromStaffReply(input: LearnInput, deps: LearningDeps): Promise<LearnResult> {
  const message = await deps.model.create({
    model: modelNameFrom(deps),
    max_tokens: 1024,
    system: buildLearnSystemPrompt(),
    messages: [{ role: "user", content: buildLearnUserMessage(input) }],
    output_config: { effort: "low", format: { type: "json_schema", schema: LEARN_JSON_SCHEMA } },
  });
  const out = parseJson(textOf(message), learnModelOutputSchema);
  const skip = (skipReason: Extract<LearnResult, { status: "skip" }>["skipReason"]): LearnResult => ({
    status: "skip",
    skipReason,
    reason: out?.reason ?? "",
  });
  if (!out) return skip("invalid_output");
  if (out.kind === "one_off" || hasOneOffMarker(input.staffReply)) return skip("one_off");
  if (!out.rule.trim()) return skip("no_rule");
  if (!evidenceInReply(out.evidence, input.staffReply)) return skip("evidence_not_found");

  const rule = redactPersonal(out.rule, input.shopperName);
  const evidence = redactPersonal(out.evidence, input.shopperName);
  if (!rule || !evidence) return skip("no_rule");
  // Never cut a rule: the cut part may hold its conditions ("trừ hàng sale").
  if (rule.length > MAX_RULE) return skip("too_long");
  if (!numbersBacked(rule, input.staffReply)) return skip("number_mismatch");

  const reviewReasons: ReviewReason[] = [];
  if (mentionsOffer(rule)) reviewReasons.push("discount");
  if (out.conflictsWithPolicy) reviewReasons.push("conflict");
  if (out.vague || hasVagueMarker(input.staffReply)) reviewReasons.push("vague");
  if (!ruleSupported(rule, out.evidence, input.staffReply)) reviewReasons.push("unverified");
  if (out.needsReview) reviewReasons.push("model");
  return {
    status: "learn",
    policyKind: out.policyKind,
    rule,
    evidence,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    reason: out.reason,
  };
}
