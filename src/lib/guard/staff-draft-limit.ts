import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// PB-20: each reply-assistant draft is a Claude call, so a shop gets a budget.
// A person pasting questions by hand stays far below it; a script or a stolen
// staff session hits it quickly. Counted from ai_turns (one row per staff_draft
// turn, written by the engine), so no new table is needed. ai_turns is written
// just after the reply, so a burst of parallel calls can pass a few over the
// limit; the browser sends server actions one at a time, so the UI cannot.
export const STAFF_DRAFT_LIMITS = [
  { windowMs: 60_000, max: 20 },
  { windowMs: 24 * 60 * 60_000, max: 500 },
] as const;

export function isOverStaffDraftLimit(counts: readonly number[]): boolean {
  return STAFF_DRAFT_LIMITS.some((limit, i) => (counts[i] ?? 0) >= limit.max);
}

export async function staffDraftLimitReached(shopId: string, now = new Date()): Promise<boolean> {
  const db = createAdminClient();
  const counts = await Promise.all(
    STAFF_DRAFT_LIMITS.map(async ({ windowMs }) => {
      const { count, error } = await db
        .from("ai_turns")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId)
        .eq("mode", "staff_draft")
        .gte("created_at", new Date(now.getTime() - windowMs).toISOString());
      // Fail open, as PB-17 does: a read error must not stop staff working.
      if (error) {
        console.error("PB-20 draft limit count failed", error.message);
        return 0;
      }
      return count ?? 0;
    }),
  );
  return isOverStaffDraftLimit(counts);
}
