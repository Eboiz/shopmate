// PB-35b: group the questions nobody answered into topics, each with a draft
// whose facts are blanks the owner fills in (Eboiz/Documents#36, #39). The model
// sees short refs, never ids, and returns refs only; code builds the topics.
import { z } from "zod";
import { gapTopicProposalSchema, policyKindSchema, type GapQuestion, type GapTopicProposal } from "@/contract";
import { toStructuredOutputSchema } from "@/lib/engine/model-reply";
import { draftIsBlankOnly } from "./checks";
import { createParsed, modelNameFrom, type LearningDeps } from "./learn";
import { buildGapsSystemPrompt, buildGapsUserMessage } from "./prompt";

export const gapsModelOutputSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      policyKind: policyKindSchema,
      refs: z.array(z.string()),
      draft: z.string(),
    }),
  ),
});

const GAPS_JSON_SCHEMA = toStructuredOutputSchema(gapsModelOutputSchema);
const MIN_CONVERSATIONS = 2;
const MAX_SAMPLES = 3;
const MAX_TITLE = 80;
const FALLBACK_TITLE = "Câu hỏi khác";

// A title states no fact and can't close a blank: tokens with a digit and
// square brackets are dropped.
function cleanTitle(title: string): string {
  const out = title.replace(/\S*\d\S*/g, " ").replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trim();
  return out || FALLBACK_TITLE;
}

// Throws when the model fails or its output can't be read: the page shows the
// recorded questions with a "try again" message.
export async function analyzeGaps(questions: GapQuestion[], deps: LearningDeps): Promise<GapTopicProposal[]> {
  if (questions.length === 0) return [];
  const byRef = new Map(questions.map((q, i) => [`q${i + 1}`, q]));
  const out = await createParsed(
    deps,
    {
      model: modelNameFrom(deps),
      max_tokens: 2048,
      system: buildGapsSystemPrompt(),
      messages: [
        { role: "user", content: buildGapsUserMessage([...byRef].map(([ref, q]) => ({ ref, question: q.question }))) },
      ],
      output_config: { effort: "low", format: { type: "json_schema", schema: GAPS_JSON_SCHEMA } },
    },
    gapsModelOutputSchema,
  );
  if (!out) throw new Error("analyzeGaps: invalid model output");

  const used = new Set<string>();
  const topics: GapTopicProposal[] = [];
  for (const t of out.topics) {
    const members = [...new Set(t.refs)].flatMap((ref) => {
      const q = byRef.get(ref);
      if (!q || used.has(ref)) return [];
      return [{ ref, q }];
    });
    const conversationCount = new Set(members.map((m) => m.q.conversationId)).size;
    if (conversationCount < MIN_CONVERSATIONS) continue;
    for (const m of members) used.add(m.ref);
    // Input order, not the model's.
    members.sort((a, b) => questions.indexOf(a.q) - questions.indexOf(b.q));
    const title = cleanTitle(t.title);
    topics.push(
      gapTopicProposalSchema.parse({
        title,
        policyKind: t.policyKind,
        questionIds: members.map((m) => m.q.id),
        conversationCount,
        sampleQuestions: [...new Set(members.map((m) => m.q.question))].slice(0, MAX_SAMPLES),
        draft: draftIsBlankOnly(t.draft) ? t.draft.trim() : `[Viết câu trả lời của shop về: ${title}]`,
      }),
    );
  }
  // Stable: ties keep the model's order.
  return topics.sort((a, b) => b.conversationCount - a.conversationCount);
}
