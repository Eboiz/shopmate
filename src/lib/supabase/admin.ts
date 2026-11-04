import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/contract";
import { publicEnv } from "@/lib/env";

// Supabase client with the secret key, for code with no signed-in user: webhooks,
// the AI engine and its tools, sendToConversation.
//
// The secret key bypasses Row Level Security. Every query made with this client
// must filter by shop_id itself.
//
// Every request skips the Next.js data cache, so an edit made in PB-16 shows in
// the very next answer. Don't call tools from inside 'use cache' either: a
// cached caller would still return the old result.
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY is not set");

  return createClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
