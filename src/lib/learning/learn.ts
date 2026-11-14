// PB-35b: learn a general rule from what a staff member told a shopper. One
// Claude call, no tools, structured output; the model only proposes and the
// checks in checks.ts decide (Eboiz/Documents#39).
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { policyKindSchema, type LearnInput, type LearnResult, type ReviewReason } from "@/contract";
import { DEFAULT_MODEL, type ModelClient } from "@/lib/engine/engine";
import { mentionsOffer } from "@/lib/engine/discount-guard";
import { firstJsonObject, toStructuredOutputSchema } from "@/lib/engine/model-reply";
import {
  evidenceInReply,
  hasOneOffMarker,
  hasVagueMarker,
  mentionsAmount,
  mentionsProductData,
  numbersBacked,
  redactPersonal,
  ruleSupported,
  tidy,
} from "./checks";
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
  // Optional: the gateway doesn't enforce the schema and the model sometimes drops it.
  reason: z.string().optional(),
});

const LEARN_JSON_SCHEMA = toStructuredOutputSchema(learnModelOutputSchema);
const MAX_RULE = 500;

export const modelNameFrom = (deps: LearningDeps) => deps.modelName ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

export const textOf = (message: Anthropic.Message) =>
  message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

// The first JSON object in the text (the model may wrap it in prose or a code
// fence when the gateway doesn't enforce the schema), if it fits the schema.
export function parseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  const parsed = schema.safeParse(firstJsonObject(raw));
  return parsed.success ? parsed.data : null;
}

const ATTEMPTS = 2;

// Sends the request and parses its output; an unreadable output is asked for
// once more (a fresh sample). null after the last attempt.
export async function createParsed<T>(
  deps: LearningDeps,
  params: Anthropic.MessageCreateParamsNonStreaming,
  schema: z.ZodType<T>,
): Promise<T | null> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const out = parseJson(textOf(await deps.model.create(params)), schema);
    if (out) return out;
  }
  return null;
}

// A model or network error is thrown: PB-35a keeps the gap open.
export async function learnFromStaffReply(input: LearnInput, deps: LearningDeps): Promise<LearnResult> {
  const out = await createParsed(
    deps,
    {
      model: modelNameFrom(deps),
      max_tokens: 1024,
      system: buildLearnSystemPrompt(),
      messages: [{ role: "user", content: buildLearnUserMessage(input) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: LEARN_JSON_SCHEMA } },
    },
    learnModelOutputSchema,
  );
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
  // Price, stock, size and product details come from the catalog tools only;
  // checked by code, not left to the model's kind.
  if (mentionsProductData(out.rule)) return skip("product_data");

  const reviewReasons: ReviewReason[] = [];
  if (mentionsOffer(rule)) reviewReasons.push("discount");
  else if (mentionsAmount(rule)) reviewReasons.push("amount");
  if (out.conflictsWithPolicy) reviewReasons.push("conflict");
  if (out.vague || hasVagueMarker(input.staffReply)) reviewReasons.push("vague");
  // Redaction may have cut the rule's conditions ("12 Lê Lợi", "Quận 1").
  if (rule !== tidy(out.rule) || !ruleSupported(rule, out.evidence, input.staffReply)) reviewReasons.push("unverified");
  if (out.needsReview) reviewReasons.push("model");
  return {
    status: "learn",
    policyKind: out.policyKind,
    rule,
    evidence,
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    reason: out.reason ?? "",
  };
}
