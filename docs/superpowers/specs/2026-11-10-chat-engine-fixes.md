# Chat engine fixes after the 07/11 production test — spec

Sources: production test report "Kiểm thử AI trên production 07/11/2026" (19 conversations, 16/19 passed,
prompt v0.6, `may-boutique`), an independent Opus review of `main` at 72dff23 (10/11/2026), and the
stories PB-05 (#5), PB-07 (#7), PB-09 (#9), PB-14 (#14) in `Eboiz/Documents`.

Since the report, `main` added the Jev router (`src/lib/engine/route.ts`, PB-10), auto-resume (eeaf901) and
prompt v1.1. Every turn the router can't handle (orders, low confidence, tool errors, Jev errors, orders in
progress) still runs the LLM tool loop, so each fix covers both paths.

## 1. Findings and expected behavior

| # | Finding (report / review) | Still on `main`? | Expected after this work | Story |
|---|---|---|---|---|
| F1 | Second turn on an unknown product ("áo khoác da" → "loại áo khoác da màu đen ấy") is not handed off: the model also searches "áo khoác" (5–7 hits), and `searchMissed` (`misunderstood.ts`) only counts a miss when **every** search is empty. A router turn logs no search, so a tool-loop turn after it never sees the miss. | yes (loop), partly (router) | The server decides "this turn missed the product" from the search for the shopper's own words, not from the model's broader searches, on both paths. Two misses in a row → handoff `misunderstood_twice` with `PRODUCT_NOT_FOUND_HANDOFF_TEXT`. | PB-05 AC3 |
| F2 | Quick replies name products the shop doesn't sell ("Áo khoác da nam", "Tìm lại áo da"); they pass from the model unchecked. | yes, both paths | A quick reply that names a garment no product of the shop matches is dropped before sending. | PB-05, PB-04 AC4 |
| F3 | `get_policy` returned the return policy and the model still handed off `not_covered_by_data`. Prompt says "handoff not_covered_by_data ngay". | yes (loop) | In a turn where `get_policy` returned text, a `handoff_to_staff` with `not_covered_by_data` is refused with a tool error telling the model to answer from the policy (or use `policy_not_covered` if the text doesn't cover the question). | PB-09 AC1 |
| F4 | "Mình lấy 2 cái, shop bớt 50k được không?" always handed off `policy_not_covered` with no refusal: the router's discount check runs after the order fallback, and prompt lines 81 and 83 contradict each other when `khuyen_mai` is empty. | partly | A discount request gets a polite refusal on both paths, no handoff (also what PB-31 expects). Eval `pb09-discount-ask` requires `handoff: null`. | PB-09 AC3 |
| F5 | Median 13.5 s, max 31.2 s. | partly | Lower latency without changing answers: cached catalog, read-only tools in parallel, identical tool calls answered from the turn's cache, a 1-letter `search_products` query refused. Effort `low` in the tool loop only if the eval does not drop. No streaming. | — |
| F6 | English in replies ("stock 7"); router facts use key `stock`, prompt says "stock 0". | yes | Vietnamese keys in router facts and prompt; a reply with an English stock/size word gets one rewrite. | PB-04 |
| F7 | Redundant `search_products("a")`. | yes | Covered by F5 (query of at least 2 letters, duplicate cache). | — |
| R1 | PB-07 number check does not exist (issue closed, ACs unticked). Wrong prices or stock from the model go out. | yes | PB-07 AC1–AC5 on both paths (section 2). | PB-07 |
| R2 | Auto-resume moves a `needs_human` conversation back to `ai` after **any** turn without handoff ("ok cảm ơn" after a complaint leaves the staff queue). | yes | Decision (developer, 10/11): resume only when the AI answered from shop data this turn (section 3). | PB-14 AC2 |
| R3 | Two shopper messages at once run two turns in parallel; the shopper gets two replies. | plausible | Only the turn for the newest shopper message sends its reply; an older turn that finishes later sends nothing. | PB-04 |

## 2. Number check (PB-07, copied from #7)

- Prices written as "350k", "350.000đ", "350.000 đ" or "350 nghìn" must equal a price returned by a tool in
  the same turn. `quote_order` line totals and order total, and numbers inside `get_policy` text, count.
- Stock quantities such as "còn 2 cái" must equal a stock value returned by a tool in the same turn.
- Numbers the shopper gave (height, weight such as "1m65", "58kg") and size names are not checked.
  Amounts that appear in the shopper's latest message ("bớt 50k") are also not checked: repeating the
  shopper's number is not a promise (the discount guard, PB-09, covers that case).
- Mismatch → the AI rewrites once. Still wrong → the product cards from data are sent instead and the
  event is logged (`ai_turns.postcheck`); the conversation stays with the AI (no handoff, PR #81 review
  2026-11-12: the AI rule is "rewrite once, then send the product card from data").
- A stock count needs its unit ("còn 3 cái/chiếc/sp/sản phẩm") or the "(còn N)" form; "còn 2 màu",
  "còn 3 size" and a bare "(1)" are not stock.
- At least 20 unit-test replies, including each price format, an order summary with a total and a
  shipping-fee answer.

## 3. Decisions (developer, 10/11/2026)

- **D1** F1 follows PB-05 AC3 (handoff on the second miss). PB-31's near-match search is out of scope here.
- **D2** Auto-resume stays, but only for a turn that ran a data tool successfully (`get_stock`,
  `search_products` with results, `get_policy` with text, `recommend_size` ok, `get_pairings`,
  `quote_order`) and did not hand off. Greetings, thanks, unclear turns and complaints keep `needs_human`.
- **D3** Scope: F1–F7, R1, R2, R3, plus latency (F5). Not in scope: the other router bugs of the review
  (color not in the product, system notices as assistant turns, tool-loop retry on unreadable reply,
  router tools counting against the loop limit), PB-31, streaming.
