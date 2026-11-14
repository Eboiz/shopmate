# Chat Engine Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the chat engine failures of the 07/11 production test and the independent review (F1–F7, R1–R3), so PB-05 AC3, PB-07, PB-09 AC1/AC3 and PB-14 AC2 hold on both the Jev router and the LLM tool loop.

**Architecture:** Each fix is a deterministic server-side guard in its own small module under `src/lib/engine/`, wired into `runEngine` at the two places a reply is accepted (router `write` loop and tool-loop final reply) or where a tool call is accepted. Per-turn guard results are written to the unused `ai_turns.postcheck` jsonb column (no migration). Prompt changes only remove contradictions; no fix relies on the prompt alone.

**Tech Stack:** Next.js 16, TypeScript, Zod 4, Vitest, Supabase, Claude API (eval only).

**Spec:** `docs/superpowers/specs/2026-11-10-chat-engine-fixes.md` (F1–F7, R1–R3, D1–D3).

## Global Constraints

- Scope is spec D3 only. Anything outside it is a question for the developer, not code.
- No migration, no contract change in `src/contract/` (tool schemas stay as they are). Guard results go in `ai_turns.postcheck` as `PostcheckLog` (Task 1).
- Every guard runs in `mode === "customer"` only, unless the task says otherwise; `staff_draft` behavior is unchanged.
- Vietnamese copy, exactly:
  - `NUMBER_RETRY_NOTE = "Câu trả lời có giá hoặc số lượng tồn kho không khớp dữ liệu tool. Viết lại, chỉ dùng đúng giá và số lượng tool trả về."`
  - `NUMBER_HANDOFF_TEXT = "Dạ, mình gửi bạn thông tin sản phẩm từ dữ liệu của shop. Nhân viên shop sẽ kiểm tra và trả lời bạn sớm nhé!"`
  - `VIETNAMESE_RETRY_NOTE = "Câu trả lời có từ tiếng Anh. Viết lại hoàn toàn bằng tiếng Việt (vd. \"còn 7 cái\", không viết \"stock\")."`
  - Tool-error text for a refused handoff (Task 3): `"Chính sách shop đã có nội dung. Trả lời khách đúng theo nội dung đó; nếu nội dung không nói tới điều khách hỏi thì dùng reason policy_not_covered."`
  - Tool-error text for a refused discount handoff (Task 3): `"Khách đòi giảm giá: không chuyển nhân viên. Từ chối lịch sự, shop không giảm thêm ngoài giá niêm yết và khuyến mãi shop đã viết."`
- `PROMPT_VERSION` → `"v1.2"` with one changelog line in `src/lib/engine/prompt.ts` (if PB-30 merges first with `v1.2`, use the next free version).
- Fold Vietnamese with the existing `fold` used in `route.ts` (or `foldVietnamese` from `@/lib/shop/catalog-view`); do not add a third folding function.
- Paid runs (`pnpm engine:eval`, `pnpm test:int` live smoke) only in Task 9 and only after the developer says go.
- Implementation follows the developer's workflow: opencode models implement, a Sonnet agent orchestrates, Opus reviews before each commit.
- PR body: `Refs Eboiz/Documents#5`, `#7`, `#9`, `#14` (never `Closes`).

## Review Focus

1. **A broadened search that finds the real product** ("váy linen" → model searches "váy suông linen" and finds it): must NOT count as a miss. Test: Task 1 `a shopper-worded search with results is not a miss even if another search is empty`.
2. **Policy that exists but doesn't cover the question** ("giao hàng Chủ nhật" with `giao_hang` text silent on days): handoff `policy_not_covered` must still pass (report PB-09 AC2 was 3/3). Test: Task 3 `policy_not_covered after get_policy with text is accepted`.
3. **Shopper's own numbers repeated in the reply** ("bớt 50k", "cao 1m65 nặng 58kg"): never flagged by the number check. Test: Task 4 `amounts from the latest shopper message and measurements are not checked`.
4. **"Ok cảm ơn" after a complaint handoff**: stays `needs_human`. Test: Task 6 `a greeting or thanks turn in needs_human does not resume`.
5. **Order flow under the newest-turn rule** (shopper sends "ok" then the phone number quickly): the older turn must not send a stale summary, and the draft order is created at most once. Test: Task 8 `older turn finishing after a newer shopper message sends nothing`.

---

### Task 1: Product miss decided by the shopper's own search (F1, PB-05 AC3)

**Files:**
- Modify: `src/lib/engine/misunderstood.ts`, `src/lib/engine/misunderstood.test.ts`, `src/lib/engine/store.ts` (`previousTurnState`, `insertTurn` row), `src/lib/engine/engine.ts` (lines ~585–590 and the router `write` branch), `src/lib/engine/route.ts` (no-product branch), `src/lib/engine/engine.test.ts`, `src/lib/engine/route.test.ts`, `src/lib/engine/eval/cases.ts`
- Create: `src/lib/engine/postcheck-log.ts`

**Interfaces:**
- Produces:
  - `postcheck-log.ts`: `type PostcheckLog = { productMiss?: boolean; numberCheck?: { failed: string[]; retried: boolean }; vietnamese?: { retried: boolean } }` and `postcheckLogSchema` (Zod, all keys optional). Engine writes it to `insertTurn({ ..., postcheck })`; later tasks add their keys.
  - `misunderstood.ts`: `shopperTurnText(history: readonly HistoryMessage[]): string` (the shopper messages after the last AI message, joined by newlines; Tasks 3 and 4 use it as `latestShopperText`), and `productMissed(logs: readonly ToolCallLog[], shopperText: string, viewingId: string | null): boolean` — rule below. `searchMissed` stays exported for old `ai_turns` rows.
  - `RouteOutcome` `write` gains `productMiss?: true`, set by the "Hỏi một câu ngắn: bạn đang hỏi sản phẩm nào" branch of `routeTurn`.
  - `previousTurnState` reads `postcheck.productMiss` when present, else falls back to `searchMissed(tool_calls)`.
- Rule for `productMissed` (the algorithm the tests pin):
  1. Successful searches = `search_products` logs without `error`. None → `false`.
  2. Shopper-worded searches = those whose folded query words all appear in the folded `shopperText` (the shopper messages after the last AI message). If none, use all successful searches.
  3. Take the shopper-worded searches with the most query words. If any of them returned products → `false`.
  4. Found ids = products of shopper-worded searches with results, plus `viewingId`. A product tool (`PRODUCT_TOOLS`) that ran ok on a found id → `false`. Otherwise → `true`.

- [ ] **Step 1: Write failing tests** in `misunderstood.test.ts`:
  - `broadened search does not hide the miss` (shopper `"loại áo khoác da màu đen ấy"`, logs `áo khoác`→5 products, `áo khoác da`→0, `get_stock` on one of the 5 → `true`)
  - `a shopper-worded search with results is not a miss even if another search is empty` (shopper `"váy suông linen màu be"`, logs `váy suông linen be`→0, `váy suông linen`→1 → `false`)
  - `product tool on the viewed product is not a miss`
  - `no search is not a miss`; `a failed search is not a miss`
- [ ] **Step 2: Write failing engine/route tests**: `engine.test.ts` `second miss hands off misunderstood_twice although the model also searched a broader query`; `router clarifying turn logs postcheck.productMiss and the next tool-loop miss hands off`; `route.test.ts` `no-product clarifying write carries productMiss`.
- [ ] **Step 3: Run** `pnpm test src/lib/engine/misunderstood.test.ts src/lib/engine/engine.test.ts src/lib/engine/route.test.ts` → FAIL.
- [ ] **Step 4: Implement.** In `runEngine`, compute `productMiss` for the turn (tool loop: `productMissed(logs, shopperTurnText(input.history), tc.product?.id ?? null)`; router: `routed.productMiss === true`), use it in place of `searchMissed(logs)` at the `productMissedTwice` line, and write `postcheck: { productMiss }`.
- [ ] **Step 5: Add eval case** `product-not-found-twice-broadened` in `eval/cases.ts`: same history as `product-not-found-twice` but last shopper text `"loại áo khoác da màu đen ấy"`, `handoff: "misunderstood_twice"`.
- [ ] **Step 6: Run** `pnpm test src/lib/engine && pnpm typecheck` → PASS.
- [ ] **Step 7: Commit** `git commit -m "fix(engine): decide a product miss from the shopper's own search (PB-05 AC3)"`

### Task 2: Quick replies only name what the shop sells (F2)

**Files:**
- Create: `src/lib/engine/quick-replies.ts`, `src/lib/engine/quick-replies.test.ts`
- Modify: `src/lib/engine/engine.ts` (router `write` reply and tool-loop final reply), `src/lib/engine/engine.test.ts`

**Interfaces:**
- Consumes: `CatalogItem` (`jev.ts`), `deps.store.catalog` (Task 7 adds the cache; here call it directly, once per turn, reusing the router's catalog when it was already read).
- Produces: `GARMENT_WORDS` (folded: `ao, vay, dam, quan, chan vay, khoac, so mi, somi, blazer, bomber, cardigan, gile, jean, jacket, len, hoodie, croptop`), `QUICK_REPLY_STOP_WORDS` (folded: `xem, dat, tim, lai, mua, them, khac, cho, minh, toi, size, mau, nhe, hoi, gi, nao, con, khong, mau khac, loai`), `filterQuickReplies(replies: QuickReply[], catalog: CatalogItem[]): QuickReply[]` — a reply with no garment word is kept; a reply with one is kept only if some product's folded `name + category + colors + sizes` contains every remaining word of the reply (after removing stop words); order kept.

- [ ] **Step 1: Write failing tests** with a catalog of `Áo khoác bomber` (đen, be), `Áo khoác jean`, `Áo blazer nữ` (đen): drops `Áo khoác da nam`, `Áo khoác da nữ`, `Tìm lại áo da`; keeps `Xem bomber`, `Áo blazer đen`, `Áo khoác jean`, `Mặc với gì đẹp`, `Đặt size S màu Trắng`, `Hỏi nhân viên`; empty catalog keeps only replies without garment words.
- [ ] **Step 2: Run** `pnpm test src/lib/engine/quick-replies.test.ts` → FAIL. **Step 3: Implement** and wire into both reply paths. Add `engine.test.ts` `quick replies naming products the shop lacks are dropped`.
- [ ] **Step 4: Run** `pnpm test src/lib/engine` → PASS.
- [ ] **Step 5: Commit** `git commit -m "fix(engine): drop quick replies naming products the shop doesn't sell"`

### Task 3: Policy and discount handoffs (F3, F4, PB-09 AC1/AC3)

**Files:**
- Create: `src/lib/engine/handoff-guard.ts`, `src/lib/engine/handoff-guard.test.ts`
- Modify: `src/lib/engine/engine.ts` (tool loop, inside `runBatch` before `executeTool`, same pattern as `blockedOrderRun`), `src/lib/engine/route.ts` (move the `discountTrick` block above the `low_confidence` and `order` fallbacks), `src/lib/engine/route.test.ts`, `src/lib/engine/prompt.ts` (+ `prompt.test.ts`), `src/lib/engine/eval/cases-pb09.ts`

**Interfaces:**
- Produces: `refusedHandoff(input: unknown, logs: readonly ToolCallLog[], history: readonly HistoryMessage[]): { code: "policy_has_text" | "discount_refusal"; message: string } | null`:
  - `not_covered_by_data` when this turn has an ok `get_policy` log with non-null `content` and no ok product tool → `policy_has_text` (message = Global Constraints text).
  - `policy_not_covered` when every ok `get_policy` of the turn is `kind: "khuyen_mai"` and `findUnbackedDiscount` / the discount word list of `discount-guard.ts` matches the latest shopper message → `discount_refusal`.
  - else `null`. A refused call returns an error tool result (`isError: true`, the message as content); it does not count as a handoff.
- Prompt (`prompt.ts`, customer mode): line "shop chưa viết thì gọi handoff_to_staff với reason policy_not_covered" gains `" (trừ khi khách đòi giảm giá: xem dòng dưới)"`; the discount line ends with `" Kể cả khi khuyen_mai trống: từ chối lịch sự, không gọi handoff_to_staff."`; in the `not_covered_by_data` line, remove `"ngay"` and add `" Câu hỏi về đổi trả, giao hàng, khuyến mãi thì gọi get_policy trước, không dùng reason này."`; bump `PROMPT_VERSION` with changelog `// v1.2: deterministic product miss, discount refusal without handoff, policy text answered (07/11 report).`

- [ ] **Step 1: Write failing tests** `handoff-guard.test.ts`: `not_covered_by_data after get_policy with text is refused`; `policy_not_covered after get_policy with text is accepted` (Review Focus 2); `not_covered_by_data with a product tool is accepted`; `policy_not_covered for an empty khuyen_mai on a discount ask is refused`; `policy_not_covered for an empty giao_hang is accepted`; `complaint and asked_for_human are never refused`.
- [ ] **Step 2: Write failing tests** `route.test.ts` `discount ask that reads like an order is refused by the router, not sent to the loop`; `prompt.test.ts` version `v1.2` and the three edited lines.
- [ ] **Step 3: Run** `pnpm test src/lib/engine` → FAIL. **Step 4: Implement.**
- [ ] **Step 5: Change eval** `pb09-discount-ask`: `handoff: null`, drop the optional `handoff_to_staff` expectation, keep `noUnbackedDiscount`, and add reply check `"refuses politely"` (`fold(text)` includes `"khong"` and one of `"giam"`, `"bot"`).
- [ ] **Step 6: Run** `pnpm test src/lib/engine && pnpm typecheck` → PASS.
- [ ] **Step 7: Commit** `git commit -m "fix(engine): answer from policy text and refuse discounts without handoff (PB-09)"`

### Task 4: Number check before sending (R1, PB-07)

**Files:**
- Create: `src/lib/engine/number-check.ts`, `src/lib/engine/number-check.test.ts`
- Modify: `src/lib/engine/engine.ts` (router `write` loop next to the discount check; tool-loop final reply next to the discount retry; the handoff block), `src/lib/engine/engine.test.ts`

**Interfaces:**
- Consumes: Task 1 `PostcheckLog.numberCheck`.
- Produces:
  - `type NumberIssue = { kind: "price" | "stock"; raw: string; value: number }`.
  - `findUncheckedNumbers(reply: string, logs: readonly ToolCallLog[], latestShopperText: string): NumberIssue[]`.
    - Prices: `(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghìn|ngàn|đ|đồng|vnđ)\b` (case-insensitive, `k`/`nghìn`/`ngàn` × 1000; "350.000 đ" = 350000). Allowed: every `price` in `search_products`/`get_stock` outputs, `unitPrice`/`lineTotal`/`total` in `quote_order`/`create_draft_order`, and every amount the same regex finds in `get_policy` content.
    - Stock: `còn\s+(\d+)\s*(cái|chiếc|sp|sản phẩm)?` and `\((?:còn\s*)?(\d+)\)`; allowed: every `stock` in `get_stock`/`search_products` outputs.
    - Never checked: measurements (`\d+m\d*`, `\d+\s*(cm|kg|ký|kí)`), size names, and any amount the price regex finds in `latestShopperText`.
  - `NUMBER_RETRY_NOTE`, `NUMBER_HANDOFF_TEXT` (Global Constraints).
  - Engine: first failure → one rewrite with `NUMBER_RETRY_NOTE` (router: appended to `task`; loop: user message like `DISCOUNT_RETRY_NOTE`). Second failure → `handoff = "postcheck_failed"`, `setNeedsHuman`, reply `NUMBER_HANDOFF_TEXT` with cards of `tc.product` or else the reply's product ids, `postcheck.numberCheck = { failed: issues.map(i => i.raw), retried: true }`. Server-written replies (order summary, size fallback, pairing reply, handoff texts) are not checked.

- [ ] **Step 1: Write ≥ 20 failing cases** in `number-check.test.ts` (table-driven): each price format (`350k`, `350.000đ`, `350.000 đ`, `350 nghìn`, `389.000đ`) matching and not matching a tool price; order summary with line totals and total; shipping fee "phí 30.000đ" from `get_policy`; `còn 7 chiếc` / `(còn 5)` vs `get_stock`; wrong stock; `1m65`, `58kg` ignored; `bớt 50k` from shopper ignored (Review Focus 3); size `M` ignored; no numbers → `[]`.
- [ ] **Step 2: Write failing engine tests**: `wrong price is rewritten once`; `wrong price twice sends the product card, hands off postcheck_failed and logs postcheck.numberCheck`; `router write with a wrong stock number is rewritten`.
- [ ] **Step 3: Run** `pnpm test src/lib/engine` → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS, `pnpm typecheck`.
- [ ] **Step 6: Commit** `git commit -m "feat(engine): number check on prices and stock before sending (PB-07)"`

### Task 5: Vietnamese-only replies (F6)

**Files:**
- Create: `src/lib/engine/vietnamese-guard.ts`, `src/lib/engine/vietnamese-guard.test.ts`
- Modify: `src/lib/engine/route.ts` (facts key `stock` → `tonKho`, and any other English fact key the reply model sees), `src/lib/engine/route.test.ts`, `src/lib/engine/prompt.ts` (`"stock 0"` → `"tồn kho 0"`), `src/lib/engine/engine.ts`

**Interfaces:**
- Produces: `findEnglish(reply: string): string | null` — first match of `\b(stock|in stock|out of stock|size chart|sold out|available)\b` (case-insensitive) or `null`; size letters, product names and brand words are not matched. `VIETNAMESE_RETRY_NOTE`. Engine: one rewrite on a match in both paths, then send whatever comes back; `postcheck.vietnamese = { retried: true }`.

- [ ] **Step 1: Write failing tests**: `"còn hàng, stock 7"` → `"stock"`; `"size M còn 7 cái"` → `null`; `"Áo khoác bomber"` → `null`; engine `English word triggers one rewrite`; route facts use `tonKho`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test src/lib/engine` → PASS.
- [ ] **Step 5: Commit** `git commit -m "fix(engine): Vietnamese facts keys and one rewrite on English words"`

### Task 6: Auto-resume only after an answer from data (R2, PB-14 AC2, D2)

**Files:**
- Create: `src/lib/engine/resume.ts`, `src/lib/engine/resume.test.ts`
- Modify: `src/lib/engine/engine.ts:703-707`, `src/lib/engine/engine.test.ts` (update the test around line 1248 that asserts resume after any turn)

**Interfaces:**
- Produces: `answeredFromData(logs: readonly ToolCallLog[]): boolean` — true when the turn has an ok log of `get_stock`, `recommend_size` with `status: "ok"`, `get_pairings`, `quote_order`, `get_policy` with non-null `content`, or `search_products` with ≥ 1 product. Engine resumes only when `mode === "customer"`, conversation is `needs_human`, `handoff === null`, `!truncated`, no number/discount postcheck failure, and `answeredFromData(logs)`.

- [ ] **Step 1: Write failing tests**: `resume.test.ts` one case per tool above plus `empty search`, `get_policy null`, `no tools` → `false`; `engine.test.ts` `a greeting or thanks turn in needs_human does not resume` (Review Focus 4) and `a stock answer in needs_human resumes`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test src/lib/engine` → PASS.
- [ ] **Step 5: Commit** `git commit -m "fix(engine): auto-resume only when the AI answered from shop data (PB-14)"`

### Task 7: Latency (F5, F7)

**Files:**
- Create: `src/lib/engine/turn-cache.ts`, `src/lib/engine/turn-cache.test.ts`
- Modify: `src/lib/engine/engine.ts` (`TOOL_CONCURRENCY`, loop `effort`, tool execution through the cache), `src/lib/engine/store.ts` (catalog cache), `src/lib/engine/engine.test.ts`

**Interfaces:**
- Produces:
  - `cachedCatalog(load: (shopId: string) => Promise<CatalogItem[]>, ttlMs = 30_000, now = Date.now): (shopId: string) => Promise<CatalogItem[]>` — per-process map, one in-flight promise per shop, a rejected load is not cached. `createSupabaseStore().catalog` uses it.
  - `turnToolCache(): { get(name: string, input: unknown): ToolRun | undefined; set(name: string, input: unknown, run: ToolRun): void }` — key = name + stable JSON of input; only read-only tools (`!isWriteTool(name)` and not `handoff_to_staff`). A cached hit returns the same result, adds no new `ToolCallLog`, still counts toward `MAX_TOOL_CALLS`.
  - `search_products` with a folded query shorter than 2 letters returns an error tool result `"query cần ít nhất 2 chữ cái: tên hoặc loại sản phẩm."` without calling the database.
  - `TOOL_CONCURRENCY = 4` for read-only batches (write tools stay at 1, as today).
  - `LOOP_EFFORT: "low" | "medium"` constant, default stays `"medium"`; Task 9 switches it to `"low"` only if the eval does not drop.

- [ ] **Step 1: Write failing tests**: `turn-cache.test.ts` (same input hits, different input misses, write tools never cached); `cachedCatalog` (second call within TTL does not load; after TTL loads again; rejected load retried); `engine.test.ts` `identical search twice in one turn hits the database once`, `search_products("a") is refused without a database call`, `two read-only tool_use blocks run concurrently` (fake handlers record overlap).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test src/lib/engine && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `git commit -m "perf(engine): cached catalog, parallel read tools, per-turn tool cache"`

### Task 8: Only the newest shopper message gets a reply (R3)

**Files:**
- Modify: `src/lib/channels/receive.ts` (between `runEngine` and `sendToConversation`), `src/lib/channels/receive.test.ts`

**Interfaces:**
- Produces: `newerShopperMessageExists(db: Db, args: { shopId: string; conversationId: string; messageId: string }): Promise<boolean>` in `receive.ts` (one query: a `messages` row of the conversation with `sender = 'shopper'` and `created_at` later than this message's). When true, the turn returns `"superseded"` (new member of the result union) and sends nothing; the engine's handoff side effects (already applied) stay. The history the newer turn reads includes both messages.

- [ ] **Step 1: Write failing tests** (existing fake-db style): `older turn finishing after a newer shopper message sends nothing` (Review Focus 5) and returns `"superseded"`; `the newest turn still sends`; `a superseded turn that handed off leaves the conversation in needs_human`; webhook routes treat `"superseded"` like `"answered"` (update their tests if they switch on the result).
- [ ] **Step 2: Run** `pnpm test src/lib/channels src/app/api` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, `pnpm typecheck`.
- [ ] **Step 5: Commit** `git commit -m "fix(chat): reply only to the newest shopper message of a burst"`

### Task 9: Verification against the report

**Files:**
- Create: `docs/e2e-reports/2026-11-<dd>-chat-engine-fixes.md` (results)
- Modify: `src/lib/engine/engine.ts` (`LOOP_EFFORT`, only if Step 3 allows)

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm db:reset && pnpm test:int` (int without the paid live smoke) → all PASS.
- [ ] **Step 2 (paid, ask the developer first):** `EVAL_RUNS=3 pnpm engine:eval` with `LOOP_EFFORT = "medium"`; compare with the latest `main` run: % correct not lower, no group lower, 0 wrong prices/stock, `product-not-found-twice-broadened` and `pb09-discount-ask` 3/3.
- [ ] **Step 3 (paid):** same run with `LOOP_EFFORT = "low"`. Keep `"low"` only if Step 2's bar still holds; record median and p95 latency of both runs.
- [ ] **Step 4:** On the PR's Vercel preview, replay the report's 7 questions × 3 (same script as the report: new shopper each run, `POST /api/shops/may-boutique/chat`) and record pass counts, median/max latency, handoff reasons from `ai_turns`. Expected: PB-05 AC3 3/3, PB-09 AC1 3/3, PB-09 AC3 3/3 with a refusal and no handoff, no English words, no quick reply naming a product the shop lacks.
- [ ] **Step 5: Commit** the results file `git commit -m "docs: chat engine fixes verified against the 07/11 report"`
