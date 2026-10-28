import "server-only";
import { redirect } from "next/navigation";
import { LOGIN_PATH } from "@/lib/auth-routes";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer for the signed-in staff member. Reads the session
// cookie, so callers must sit behind a <Suspense> boundary.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}
