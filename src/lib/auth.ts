import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LOGIN_PATH } from "@/lib/auth-routes";
import type { ProfileRole } from "@/contract";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer for the signed-in staff member. Reads the session
// cookie, so callers must sit behind a <Suspense> boundary.
export async function requireUser() {
  // Checking the session compares the token's expiry with the clock (Date.now() in
  // supabase-js). With partialPrefetching the cookies resolve while prerendering,
  // so wait for the real request first; no admin page is useful without it.
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}

export type StaffProfile = {
  userId: string;
  shopId: string;
  role: ProfileRole;
};

// The signed-in user's staff profile, or null when the account belongs to no
// shop (signed up or created by hand without a profiles row). The admin layout
// uses it to show a clear notice instead of a page that can't load.
export async function findStaffProfile(): Promise<StaffProfile | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("shop_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  if (!profile) return null;
  return { userId: user.id, shopId: profile.shop_id, role: profile.role };
}

// The signed-in staff member's shop, read straight from their profile row.
// Never accept a shopId from the request body: engine inputs carry no shop in
// staff_draft mode, and callers fill deps.staffShopId from this function.
export async function requireStaff(): Promise<StaffProfile> {
  const profile = await findStaffProfile();
  if (!profile) throw new Error("Signed-in user has no profile row");
  return profile;
}
