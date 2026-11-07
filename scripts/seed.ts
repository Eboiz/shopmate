// Loads one shop from supabase/seed/<data>/*.csv, plus an eval shop with the same
// data (PB-10) and that shop's owner and staff accounts (PB-19). Two data sets:
//   demo          Hạnh Boutique, the PO's catalog and test set (PB-28); the default.
//                 Accounts DEMO_OWNER_* / DEMO_STAFF_*; the only shop with chat channels.
//   may-boutique  Mây Boutique, the 60-product catalog of PR #41.
//                 Accounts MAY_BOUTIQUE_OWNER_* / MAY_BOUTIQUE_STAFF_*.
//
//   pnpm db:seed [--data=<name>]                   local Supabase (`pnpm db:start`)
//   pnpm db:seed --target=shared --confirm=<ref>   the team's Supabase project
//   pnpm db:seed --check [--data=<name>]           only read and check the CSV files
//   pnpm db:seed --only=channels [--target=...]    only the chat channel accounts (PB-15, PB-21)
//     [--telegram-webhook=<base URL>]             also point the Telegram bot's webhook there
//
// Safe to run again: rows are upserted on their natural keys. Each run resets
// name, price and stock to the CSV, so on the shared
// project it also undoes PB-16 edits and stock taken by confirmed orders.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/contract/database.types.ts";
import { readDemoData, SHEET_COLUMNS, type DemoData, type SheetName } from "../src/lib/seed/sheet.ts";
import { checkTestQuestions } from "../src/lib/seed/questions.ts";

const root = new URL("../", import.meta.url);
const { values: args } = parseArgs({
  options: { check: { type: "boolean" }, target: { type: "string" }, confirm: { type: "string" }, only: { type: "string" },
    "telegram-webhook": { type: "string" }, accounts: { type: "string" }, data: { type: "string", default: "demo" } },
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const dataSet = args.data;
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dataSet)) fail(`--data=${dataSet}: use a folder name of supabase/seed/`);
const dataPath = `supabase/seed/${dataSet}`;
const demoDir = new URL(`${dataPath}/`, root);
if (!existsSync(new URL("shop.csv", demoDir))) fail(`${dataPath}/shop.csv not found`);
// The Facebook Page and the Telegram bot can belong to one shop only: the PO's demo shop.
const hasChannels = dataSet === "demo";
const accountPrefix = dataSet === "demo" ? "DEMO" : dataSet.toUpperCase().replaceAll("-", "_");

// 1. Read and check every sheet before touching any database.
const csv = Object.fromEntries(
  (Object.keys(SHEET_COLUMNS) as SheetName[]).map((s) => [s, readFileSync(new URL(`${s}.csv`, demoDir), "utf8")]),
) as Record<SheetName, string>;
const { data, errors, warnings } = readDemoData(csv, { expectCounts: dataSet === "demo" });
for (const w of warnings) console.warn(`! ${w}`);
if (!data) fail(`${dataPath} has ${errors.length} error(s):\n  ${errors.join("\n  ")}`);
console.log(`✓ CSV ${dataSet}: ${data.products.length} products, ${data.variants.length} variants, ${data.pairings.length} pairings`);
// Only the PO's data set has a test set (PB-28).
const questionFile = new URL("test_questions.csv", demoDir);
const questionCsv = existsSync(questionFile) ? readFileSync(questionFile, "utf8") : null;
if (questionCsv !== null) {
  const questionErrors = checkTestQuestions(data, questionCsv);
  if (questionErrors.length) fail(questionErrors.join("\n  "));
  console.log("✓ PO test set: 60 question fixtures match the catalog labels");
}
if (args.only !== "channels") {
  for (const product of data.products) {
    const path = new URL(`images/${product.code}.jpg`, demoDir);
    if (!existsSync(path)) fail(`missing photo: ${product.code}.jpg`);
    const file = readFileSync(path);
    if (file.length >= 200000 || file[0] !== 0xff || file[1] !== 0xd8) {
      fail(`${product.code}.jpg must be a JPEG smaller than 200 KB`);
    }
  }
  console.log(`✓ ${data.products.length} JPEG photos smaller than 200 KB`);
}
if (args.accounts !== undefined && args.accounts !== "existing") fail("use --accounts=existing to reuse the current demo accounts");
if (args.check) process.exit(0);
if (args.only !== undefined && args.only !== "channels") fail(`unknown --only=${args.only}; use --only=channels`);
if (args.only === "channels" && !hasChannels) fail("chat channels belong to the demo shop: drop --data");

// 2. Pick the target. Local is the default; the shared project needs its ref typed out.
const envFile = new URL(".env.local", root);
if (existsSync(envFile)) process.loadEnvFile(envFile);

function connection() {
  if (args.target === "shared") {
    const env = (name: string) => process.env[name]?.trim() || fail(`${name} is not set in .env.local`);
    const url = env("NEXT_PUBLIC_SUPABASE_URL");
    const ref = new URL(url).hostname.split(".")[0];
    if (args.confirm !== ref) fail(`writing to the shared project needs --confirm=${ref}`);
    return { url, secretKey: env("SUPABASE_SECRET_KEY"), publishableKey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") };
  }
  if (args.target !== undefined) fail(`unknown --target=${args.target}; use --target=shared or leave it out for local`);
  const status = execSync("supabase status -o env", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const local = Object.fromEntries([...status.matchAll(/^(\w+)="(.*)"$/gm)].map((m) => [m[1], m[2]]));
  return {
    url: local.API_URL ?? fail("local Supabase is not running: `pnpm db:start`"),
    secretKey: local.SECRET_KEY ?? fail("`supabase status` printed no SECRET_KEY"),
    publishableKey: local.PUBLISHABLE_KEY ?? fail("`supabase status` printed no PUBLISHABLE_KEY"),
  };
}
const { url, secretKey, publishableKey } = connection();

const accounts = (["owner", "staff"] as const).map((role) => {
  const prefix = `${accountPrefix}_${role.toUpperCase()}`;
  const email = process.env[`${prefix}_EMAIL`]?.trim() || fail(`${prefix}_EMAIL is not set in .env.local`);
  const password = process.env[`${prefix}_PASSWORD`] || fail(`${prefix}_PASSWORD is not set in .env.local`);
  return { role, email: email.toLowerCase(), password };
});
if (accounts[0].email === accounts[1].email) fail(`${accountPrefix}_OWNER_EMAIL and ${accountPrefix}_STAFF_EMAIL must be different accounts`);
type Account = (typeof accounts)[number];
console.log(`→ Seeding ${url}`);

const client = (key: string) =>
  createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const db = client(secretKey);

type Result<T> = { data: T; error: { message: string } | null };
function must<T>(result: Result<T>, what: string): NonNullable<T> {
  if (result.error || result.data == null) fail(`${what}: ${result.error?.message ?? "no data"}`);
  return result.data;
}
function ok(result: { error: { message: string } | null }, what: string) {
  if (result.error) fail(`${what}: ${result.error.message}`);
}

// 3. Product photos: supabase/seed/<data>/images/<code>.jpg, shared by the shop and its
// eval copy. The bucket is keyed by product code, so data sets must not share codes.
async function uploadImages(d: DemoData) {
  const bucket = db.storage.from("product-images");
  const codes = d.products.map((p) => p.code).filter((code) => {
    const found = existsSync(new URL(`images/${code}.jpg`, demoDir));
    if (!found) console.warn(`! ${code}: no photo in ${dataPath}/images/${code}.jpg`);
    return found;
  });
  // 5 at a time, one retry: 30 parallel uploads to the hosted project sometimes
  // dropped one with "fetch failed" (1 run in 6 on 05/11).
  const upload = async (code: string) => {
    const file = readFileSync(new URL(`images/${code}.jpg`, demoDir));
    const put = () => bucket.upload(`${code}.jpg`, file, { contentType: "image/jpeg", upsert: true });
    const first = await put();
    ok(first.error ? await put() : first, `photo ${code}.jpg`);
  };
  for (let i = 0; i < codes.length; i += 5) await Promise.all(codes.slice(i, i + 5).map(upload));
  return new Map(codes.map((code) => [code, bucket.getPublicUrl(`${code}.jpg`).data.publicUrl]));
}

// 4. Write one shop. The secret key bypasses RLS, so every read filters by shop_id.
async function seedShop(name: string, slug: string, d: DemoData, imageUrls: Map<string, string>) {
  const { id: shop_id } = must(
    await db.from("shops").upsert({ name, slug }, { onConflict: "slug" }).select("id").single(),
    `shop ${slug}`,
  );

  const products = must(
    await db.from("products").upsert(
      d.products.map((p) => ({
        shop_id, code: p.code, name: p.name, category: p.category, price: p.price, description: p.description,
        image_url: imageUrls.get(p.code) ?? null,
      })),
      { onConflict: "shop_id,code" },
    ).select("id, code"),
    `${slug} products`,
  );
  const productId = new Map(products.map((p) => [p.code, p.id]));
  const id = (code: string) => productId.get(code) ?? fail(`${slug}: product ${code} was not written`);

  ok(
    await db.from("variants").upsert(
      d.variants.map((v) => ({ shop_id, product_id: id(v.code), size: v.size, color: v.color, stock: v.stock })),
      { onConflict: "product_id,size,color" },
    ),
    `${slug} variants`,
  );
  ok(
    await db.from("size_charts").upsert(
      d.sizeCharts.map((c) => ({
        shop_id, product_id: id(c.code), size: c.size,
        height_min_cm: c.heightMin, height_max_cm: c.heightMax, weight_min_kg: c.weightMin, weight_max_kg: c.weightMax,
      })),
      { onConflict: "product_id,size" },
    ),
    `${slug} size charts`,
  );
  ok(
    await db.from("policies").upsert(
      d.policies.map((p) => ({ shop_id, kind: p.kind, content: p.content })),
      { onConflict: "shop_id,kind" },
    ),
    `${slug} policies`,
  );

  // pairings has a unique index on (least, greatest), which upsert can't target:
  // insert the missing pairs, update the reason of the existing ones.
  const existing = must(
    await db.from("pairings").select("id, product_a_id, product_b_id, reason").eq("shop_id", shop_id),
    `${slug} pairings`,
  );
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const byPair = new Map(existing.map((p) => [pairKey(p.product_a_id, p.product_b_id), p]));
  const missing = [];
  for (const p of d.pairings) {
    const [a, b] = [id(p.a), id(p.b)];
    const found = byPair.get(pairKey(a, b));
    if (!found) missing.push({ shop_id, product_a_id: a, product_b_id: b, reason: p.reason });
    else if (found.reason !== p.reason) {
      ok(await db.from("pairings").update({ reason: p.reason }).eq("id", found.id).eq("shop_id", shop_id), `${slug} pairing reason`);
    }
  }
  if (missing.length > 0) ok(await db.from("pairings").insert(missing), `${slug} new pairings`);

  // Rows the CSV no longer has are reported, never deleted (other people's data
  // on the shared project, and orders may point at them).
  const csvCodes = new Set(d.products.map((p) => p.code));
  const all = must(await db.from("products").select("code").eq("shop_id", shop_id), `${slug} product codes`);
  for (const p of all) {
    if (!csvCodes.has(p.code)) console.warn(`! ${slug}: product ${p.code} is in the database but not in products.csv`);
  }

  return shop_id;
}

// Verify every source row and question label in each shop, including unexpected
// rows that could change search results or pairing suggestions.
async function verifyCatalog(shop_id: string, slug: string, source: DemoData) {
  const products = must(await db.from("products")
    .select("id,code,name,category,price,description,variants(size,color,stock),size_charts(size,height_min_cm,height_max_cm,weight_min_kg,weight_max_kg)")
    .eq("shop_id", shop_id), `${slug} catalog read back`);
  const codeById = new Map(products.map((p) => [p.id, p.code]));
  const pairs = must(await db.from("pairings").select("product_a_id,product_b_id,reason").eq("shop_id", shop_id), `${slug} pairing read back`);
  const policies = must(await db.from("policies").select("kind,content").eq("shop_id", shop_id), `${slug} policy read back`);
  const actual: DemoData = {
    shop: source.shop,
    products: products.map((p) => ({ code: p.code, name: p.name, category: p.category, price: p.price, description: p.description })),
    variants: products.flatMap((p) => p.variants.map((v) => ({ code: p.code, ...v }))),
    sizeCharts: products.flatMap((p) => p.size_charts.map((c) => ({
      code: p.code, size: c.size, heightMin: c.height_min_cm, heightMax: c.height_max_cm,
      weightMin: c.weight_min_kg, weightMax: c.weight_max_kg,
    }))),
    pairings: pairs.map((p) => ({ a: codeById.get(p.product_a_id)!, b: codeById.get(p.product_b_id)!, reason: p.reason })),
    policies,
  };
  const errors = questionCsv === null ? [] : checkTestQuestions(actual, questionCsv);
  if (errors.length) fail(`${slug}: ${errors.join("\n  ")}`);
  const sourceCodes = new Set(source.products.map((p) => p.code));
  const sourceRows = {
    products: actual.products.filter((p) => sourceCodes.has(p.code)),
    variants: actual.variants.filter((v) => sourceCodes.has(v.code)),
    sizeCharts: actual.sizeCharts.filter((c) => sourceCodes.has(c.code)),
    pairings: actual.pairings.filter((p) => sourceCodes.has(p.a) || sourceCodes.has(p.b)),
    policies: actual.policies,
  };
  const canonical = (rows: object[]) => rows.map((row) => JSON.stringify(Object.entries(row).sort())).sort().join("\n");
  for (const table of ["products", "variants", "sizeCharts", "policies"] as const) {
    if (canonical(sourceRows[table]) !== canonical(source[table])) fail(`${slug}: ${table} differs from ${dataPath}`);
  }
  const canonicalPairs = (rows: DemoData["pairings"]) => rows.map((p) => ({ pair: [p.a, p.b].sort().join("|"), reason: p.reason }));
  if (canonical(canonicalPairs(sourceRows.pairings)) !== canonical(canonicalPairs(source.pairings))) fail(`${slug}: pairings differ from ${dataPath}`);
  console.log(`✓ ${slug}: every catalog row${questionCsv === null ? "" : " and all 60 question fixtures"} verified`);
}

// 5. Demo accounts: create, or reset the password to the one in .env.local.
async function findUser(email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) fail(`listing users: ${error.message}`);
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user || data.users.length < 100) return user ?? null;
  }
}

async function seedAccount(shop_id: string, a: Account) {
  const user = await findUser(a.email);
  if (user) {
    // Never move a real teammate's account out of their shop: they would lose access to it.
    const { data: profile, error } = await db.from("profiles").select("shop_id,role").eq("id", user.id).maybeSingle();
    if (error) fail(`${a.role} profile: ${error.message}`);
    if (profile && profile.shop_id !== shop_id) fail(`${a.email} already belongs to another shop; pick another ${accountPrefix}_${a.role.toUpperCase()}_EMAIL`);
    if (args.accounts === "existing") {
      if (!profile || profile.role !== a.role) fail(`${a.role} existing profile does not match the demo shop`);
      return;
    }
  }
  if (args.accounts === "existing") fail(`${a.role} existing account was not found`);
  const result = user
    ? await db.auth.admin.updateUserById(user.id, { password: a.password, email_confirm: true })
    : await db.auth.admin.createUser({ email: a.email, password: a.password, email_confirm: true });
  if (result.error) fail(`${a.role} account ${a.email}: ${result.error.message}`);
  ok(
    await db.from("profiles").upsert({ id: result.data.user.id, shop_id, role: a.role, full_name: `Demo ${a.role}` }),
    `${a.role} profile`,
  );
}

// 5b. The demo shop's chat channels: its Facebook Page (PB-15) and Telegram bot
// (PB-21). Tokens come from .env.local and never enter the repo; each webhook finds
// the shop from these rows. A channel whose variables are missing is skipped.
const optionalEnv = (name: string) => process.env[name]?.trim() || undefined;
const messengerEnv = () => {
  const pageId = optionalEnv("MESSENGER_PAGE_ID");
  const token = optionalEnv("MESSENGER_PAGE_ACCESS_TOKEN");
  return pageId && token ? { pageId, token } : null;
};
const telegramEnv = () => {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const secret = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  return token && secret ? { token, secret } : null;
};

async function seedChannelAccount(
  shop_id: string,
  channel: "messenger" | "telegram",
  external_account_id: string,
  access_token: string,
  webhook_secret: string | null = null,
) {
  // Never move an account that another shop already uses.
  const existing = await db.from("channel_accounts").select("shop_id")
    .eq("channel", channel).eq("external_account_id", external_account_id).maybeSingle();
  ok(existing, `${channel} channel account read`);
  if (existing.data && existing.data.shop_id !== shop_id) fail(`${channel} ${external_account_id} belongs to another shop`);
  return must(
    await db.from("channel_accounts")
      .upsert({ shop_id, channel, external_account_id, access_token, webhook_secret }, { onConflict: "channel,external_account_id" })
      .select("id").single(),
    `${channel} channel account`,
  );
}

async function seedChannels(shop_id: string, slug: string) {
  const messenger = messengerEnv();
  if (messenger) {
    await seedChannelAccount(shop_id, "messenger", messenger.pageId, messenger.token);
    console.log(`✓ messenger: Page ${messenger.pageId} → ${slug}`);
  } else console.warn("! MESSENGER_PAGE_ID or MESSENGER_PAGE_ACCESS_TOKEN not set in .env.local: no Messenger channel");

  const telegram = telegramEnv();
  if (!telegram) {
    console.warn("! TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET not set in .env.local: no Telegram channel");
    return;
  }
  // The bot id is the number before ":" in its token. Never print the token itself.
  const botId = telegram.token.match(/^(\d+):[\w-]+$/)?.[1] ?? fail("TELEGRAM_BOT_TOKEN is not a bot token (<id>:<secret>)");
  const row = await seedChannelAccount(shop_id, "telegram", botId, telegram.token, telegram.secret);
  console.log(`✓ telegram: bot ${botId} → ${slug}`);

  const base = args["telegram-webhook"];
  if (base === undefined) return;
  const url = `${base.replace(/\/$/, "")}/api/webhooks/telegram/${row.id}`;
  const response = await fetch(`https://api.telegram.org/bot${telegram.token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: telegram.secret, allowed_updates: ["message"] }),
  });
  const result = (await response.json()) as { ok: boolean; description?: string };
  if (!result.ok) fail(`setWebhook: ${result.description}`);
  console.log(`✓ telegram: webhook → ${url}`);
}

// The full seed, or with --only=channels just the channel accounts.
if (args.only === undefined) {
  if (args.accounts === "existing") {
    const shop = must(await db.from("shops").select("id").eq("slug", data.shop.slug).single(), "existing demo shop (apply PB-28 migration first)");
    for (const account of accounts) {
      await seedAccount(shop.id, account);
      const login = client(publishableKey);
      ok(await login.auth.signInWithPassword({ email: account.email, password: account.password }), `${account.role} existing sign-in`);
      await login.auth.signOut({ scope: "local" });
    }
  }
  const imageUrls = await uploadImages(data);
  const shops = [data.shop, { name: `${data.shop.name} (eval)`, slug: `${data.shop.slug}-eval` }];
  const [demoId, evalId] = await Promise.all(shops.map((s) => seedShop(s.name, s.slug, data, imageUrls)));
  for (const a of accounts) await seedAccount(demoId, a);
  if (hasChannels) await seedChannels(demoId, data.shop.slug);

  // 6. Read back what is now in the database, per shop.
  async function count(table: "products" | "variants" | "size_charts" | "pairings" | "policies" | "profiles", shop_id: string, withoutPhoto = false) {
    let query = db.from(table).select("*", { count: "exact", head: true }).eq("shop_id", shop_id);
    if (withoutPhoto) query = query.is("image_url", null);
    const { count, error } = await query;
    if (error) fail(`counting ${table}: ${error.message}`);
    return count;
  }
  // More rows than the CSV means rows a previous CSV had (or added in the app): they
  // stay, and the AI still sells or suggests them, so say so.
  const expected = {
    products: data.products.length, variants: data.variants.length, size_charts: data.sizeCharts.length,
    pairings: data.pairings.length, policies: data.policies.length,
  };
  const tables = ["products", "variants", "size_charts", "pairings", "policies", "profiles"] as const;
  for (const [i, shop_id] of [demoId, evalId].entries()) {
    const counts = await Promise.all([
      ...tables.map(async (t) => {
        const n = await count(t, shop_id);
        if (t !== "profiles" && (n ?? 0) > expected[t]) {
          console.warn(`! ${shops[i].slug}: ${t} has ${n} rows, the CSV ${expected[t]}; the extra rows are kept`);
        }
        return `${t} ${n}`;
      }),
      count("products", shop_id, true).then((n) => `without photo ${n}`),
    ]);
    console.log(`✓ ${shops[i].slug}: ${counts.join(", ")}`);
  }

  // DoD: 5 random products of the CSV match the database (price, stock, size chart).
  const picked = [...data.products].sort(() => Math.random() - 0.5).slice(0, 5);
  const fromDb = must(
    await db.from("products")
      .select("code, price, variants(size, color, stock), size_charts(size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)")
      .eq("shop_id", demoId).in("code", picked.map((p) => p.code)),
    "sample read back",
  );
  // Each CSV row must be in the database as written; extra database rows (an older
  // CSV, PB-16 edits) are reported by the counts above, not here.
  const mismatched = picked.filter((p) => {
    const row = fromDb.find((r) => r.code === p.code);
    if (!row || row.price !== p.price) return true;
    const variantsMatch = data.variants.filter((v) => v.code === p.code).every((v) =>
      row.variants.some((d) => d.size === v.size && d.color === v.color && d.stock === v.stock));
    const chartsMatch = data.sizeCharts.filter((c) => c.code === p.code).every((c) =>
      row.size_charts.some((d) => d.size === c.size && d.height_min_cm === c.heightMin && d.height_max_cm === c.heightMax
        && d.weight_min_kg === c.weightMin && d.weight_max_kg === c.weightMax));
    return !variantsMatch || !chartsMatch;
  });
  if (mismatched.length > 0) fail(`CSV and database differ for ${mismatched.map((p) => p.code).join(", ")}`);
  console.log(`✓ 5 random products match the CSV: ${picked.map((p) => p.code).join(", ")}`);
  await verifyCatalog(demoId, shops[0].slug, data);
  await verifyCatalog(evalId, shops[1].slug, data);

  // 7. Two-shop isolation (RLS), checked as the real users through the publishable
  // key. pgTAP (supabase/tests/rls.test.sql) covers every case inside a rolled-back
  // transaction; this repeats the main ones on the seeded data. The write attempts
  // are harmless even if RLS were broken: the update writes back the value already
  // there, and the insert reuses an existing code, so the database refuses it anyway.
  // An update that RLS filters out returns 0 rows without an error, so count the rows.
  let failed = false;
  function check(what: string, passed: boolean) {
    console.log(`${passed ? "✓" : "✗"} ${what}`);
    failed ||= !passed;
  }
  async function signedIn(a: Account) {
    const c = client(publishableKey);
    const { error } = await c.auth.signInWithPassword({ email: a.email, password: a.password });
    if (error) fail(`${a.role} sign-in: ${error.message}`);
    return c;
  }
  const [owner, staff] = await Promise.all(accounts.map(signedIn));
  const sample = data.products[0];

  const own = await owner.from("products").select("id, shop_id");
  check("owner reads the products of their shop only",
    (own.data?.length ?? 0) >= data.products.length && own.data!.every((p) => p.shop_id === demoId));
  const evalRead = await owner.from("products").select("id").eq("shop_id", evalId);
  check("owner reads 0 products of the eval shop", evalRead.data?.length === 0);
  const evalUpdate = await owner.from("products").update({ name: sample.name })
    .eq("shop_id", evalId).eq("code", sample.code).select("id");
  check("owner's update of an eval shop product changes 0 rows", evalUpdate.data?.length === 0);
  const evalInsert = await owner.from("products")
    .insert({ shop_id: evalId, code: sample.code, name: sample.name, price: sample.price }).select("id");
  check("owner cannot add a product to the eval shop (RLS, not the duplicate code)", evalInsert.error?.code === "42501");
  const staffEdit = await staff.from("products").update({ price: sample.price })
    .eq("shop_id", demoId).eq("code", sample.code).select("id");
  check("staff cannot change a price (owner only, PB-16)", staffEdit.data?.length === 0);
  const anonRead = await client(publishableKey).from("products").select("id");
  check("anon cannot read products", anonRead.error?.code === "42501");
  const after = must(await db.from("products").select("code, name, price").eq("shop_id", evalId), "eval shop read back");
  check("read back: eval shop products unchanged",
    data.products.every((q) => after.some((p) => p.code === q.code && p.name === q.name && p.price === q.price)));
  await Promise.all([owner.auth.signOut({ scope: "local" }), staff.auth.signOut({ scope: "local" })]);
  if (failed) process.exit(1);
} else {
  // --only=channels touches nothing but channel_accounts: no prices, stock, photos or
  // passwords, so it is safe on the shared project while the team tests there. It
  // ends without process.exit: exiting while fetch sockets are open crashes Node on Windows.
  if (!messengerEnv() && !telegramEnv()) {
    fail("no channel to seed: set MESSENGER_PAGE_ID + MESSENGER_PAGE_ACCESS_TOKEN or TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET in .env.local");
  }
  const shop = must(
    await db.from("shops").select("id").eq("slug", data.shop.slug).maybeSingle(),
    `shop ${data.shop.slug} (run the full seed first)`,
  );
  await seedChannels(shop.id, data.shop.slug);
}
