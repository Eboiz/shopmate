import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/contract";
import { publicEnv } from "@/lib/env";

export function createClient() {
  const env = publicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
