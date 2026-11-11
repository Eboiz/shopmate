// Per-turn guard results, written to ai_turns.postcheck (the unused jsonb
// column, PB-05 AC3 — no migration). Each key is one guard's verdict for the
// turn; a later fix adds its own key. All keys optional, so rows written before
// a guard existed still parse, and the next turn reads only what is there.
import { z } from "zod";

export const postcheckLogSchema = z.object({
  // PB-05 AC3: this turn searched for the shopper's own words and found nothing.
  productMiss: z.boolean().optional(),
  // PB-07: numbers in the reply no tool returned, and whether a rewrite was tried.
  numberCheck: z.object({ failed: z.array(z.string()), retried: z.boolean() }).optional(),
  // PB-04: an English stock/size word in the reply, and whether a rewrite was tried.
  vietnamese: z.object({ retried: z.boolean() }).optional(),
});

export type PostcheckLog = z.infer<typeof postcheckLogSchema>;
