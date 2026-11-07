import "server-only";
import type { StaffProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Route handlers under /api/admin: like requireStaff (src/lib/auth.ts), but
// returns null instead of redirecting, so the caller answers 401 with JSON.
// The client it returns carries the staff member's session, so Row Level
// Security applies to every query made with it.
export async function staffSession() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data: profile } = await db.from("profiles").select("shop_id, role").eq("id", user.id).maybeSingle();
  if (!profile) return null;

  const staff: StaffProfile = { userId: user.id, shopId: profile.shop_id, role: profile.role };
  return { db, staff };
}
