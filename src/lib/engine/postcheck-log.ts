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
  // R3: written by a channel turn until the channel decides whether its reply
  // goes out (receive.ts); a pending row is never the previous turn (store.ts).
  pending: z.literal(true).optional(),
  // R3: the reply was never sent (a newer shopper message arrived, or staff took
  // over first). The next turn's state skips this row (store.ts).
  superseded: z.literal(true).optional(),
});

export type PostcheckLog = z.infer<typeof postcheckLogSchema>;
