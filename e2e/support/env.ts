import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/contract/database.types";

// Where the run happens. The nightly local job starts its own Supabase, seeds the
// demo shop and passes E2E_SUPABASE_*; a run against a deployment (E2E_BASE_URL)
// has no database access and only runs read-only tests tagged @smoke.
export const againstDeployment = Boolean(process.env.E2E_BASE_URL);

const url = process.env.E2E_SUPABASE_URL;
const secretKey = process.env.E2E_SUPABASE_SECRET_KEY;

// Never point these at the team's shared project: the tests write conversations.
export const db =
  url && secretKey && !againstDeployment
    ? createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

export const NEEDS_DB = "needs the local Supabase of the nightly job (E2E_SUPABASE_URL, E2E_SUPABASE_SECRET_KEY)";

export const demo = {
  owner: { email: process.env.DEMO_OWNER_EMAIL ?? "", password: process.env.DEMO_OWNER_PASSWORD ?? "" },
  staff: { email: process.env.DEMO_STAFF_EMAIL ?? "", password: process.env.DEMO_STAFF_PASSWORD ?? "" },
};

export const channelSecrets = {
  metaAppSecret: process.env.META_APP_SECRET ?? "",
  metaVerifyToken: process.env.META_VERIFY_TOKEN ?? "",
  messengerPageId: process.env.MESSENGER_PAGE_ID ?? "",
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
};

// Unique per call, so tests never collide with each other or an earlier run.
export const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
