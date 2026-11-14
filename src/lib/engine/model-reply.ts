import { z } from "zod";
import { idSchema, modelReplySchema, quickReplySchema, type ModelReply } from "@/contract";
import { VIEWING_PRODUCT_REF } from "./prompt";

export const FALLBACK_TEXT = "Dạ, bạn nói rõ hơn giúp mình được không ạ?";

const MAX_TEXT = 1000;
const MAX_ITEMS = 10;

// Structured output rejects length/count/range keywords, so they are removed
// here; the prompt states the limits and parseModelReply enforces them.
// modelReplySchema in the contract keeps them.
const UNSUPPORTED = new Set(["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "multipleOf"]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !UNSUPPORTED.has(key))
        .map(([key, value]) => [key, strip(value)]),
    );
  }
  return node;
}

// A Zod schema as a JSON schema structured output accepts (also PB-35b's learning).
export function toStructuredOutputSchema(zodSchema: z.ZodType): Record<string, unknown> {
  const schema: Record<string, unknown> = z.toJSONSchema(zodSchema);
  delete schema.$schema;
  return strip(schema) as Record<string, unknown>;
}

export const MODEL_REPLY_JSON_SCHEMA = toStructuredOutputSchema(modelReplySchema);

// The first balanced {...} in raw, skipping braces inside strings.
export function firstJsonObject(raw: string): unknown {
  for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

function cut(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  let out = text.slice(0, MAX_TEXT);
  // Don't leave half of a surrogate pair (e.g. an emoji) at the end.
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

// Turns the model's final text into a reply that always passes modelReplySchema.
// ok is false when the text was unusable and FALLBACK_TEXT is sent instead.
export function parseModelReply(raw: string): { reply: ModelReply; ok: boolean } {
  const value = firstJsonObject(raw) as Record<string, unknown> | undefined;
  const text = value?.text;
  if (typeof text !== "string" || text.trim() === "") {
    return { reply: { text: FALLBACK_TEXT, productIds: [], quickReplies: [] }, ok: false };
  }
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const productIds = [
    ...new Set(list(value?.productIds).filter((id): id is string => id === VIEWING_PRODUCT_REF || idSchema.safeParse(id).success)),
  ].slice(0, MAX_ITEMS);
  const quickReplies = list(value?.quickReplies)
    .flatMap((q) => {
      const parsed = quickReplySchema.safeParse(q);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_ITEMS);
  return { reply: { text: cut(text), productIds, quickReplies }, ok: true };
}
