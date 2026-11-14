# PB-34 Search the shop by description or photo — spec

Source: [Eboiz/Documents#35](https://github.com/Eboiz/Documents/issues/35), developer request (10/11/2026). The story there is section 1 of this file
(issue opened 10/11/2026). Assumptions A1–A5 still need PO approval.

PB-30 (`feat/pb-30-customer-photos`) already builds photo search for the AI assistant: the `embedder/`
package (EmbeddingGemma 2 + Qdrant on Modal) with an offline flow that indexes each shop's catalog
(photo + name, category, description, colors) and an online flow `POST /search`. PB-34 reuses those
vectors and that service for the search bar of the shop page. PB-34 is built **independently** of
PB-30: everything it needs from PB-30 sits behind the contract in section 3 and is mocked until PB-30
is merged.

## 1. Story

**As Thảo**, I want to type what I'm looking for in my own words ("váy dài màu be đi biển") or drop a
photo of a similar item into the search bar of the shop page, **so that** I find matching products
without knowing their names.

### Acceptance criteria

- **AC1** Typing in the search bar still filters the list at once by name, group and color (today's
  behavior, `matchesQuery`). Pressing Enter or the search button with at least 2 characters runs a
  description search: the list shows the matching products of this shop, best match first, at most 10,
  under the heading `Kết quả cho “<text>”` with a `Xóa tìm kiếm` button that brings the full list back.
- **AC2** A photo button (`Tìm bằng ảnh`) next to the search bar lets Thảo pick a photo, or paste one
  (Ctrl+V) into the search box. A thumbnail shows in the bar and can be removed. Picking or pasting a
  photo runs the search at once; text in the box is sent with the photo. Only JPEG, PNG and WebP up to
  5 MB are accepted, with the same Vietnamese messages as PB-30.
- **AC3** Results are products of this shop only, shown with the normal product cards (price, colors,
  sizes from the catalog, never from the search service). Products below the score floor are not shown.
  When nothing is left, the existing empty state shows with `Hỏi trợ lý AI`, which opens the chat with
  the typed text as a draft.
- **AC4** When the search service is off, down or slow (over 8 s): a text search keeps the instant
  filter result with no error; a photo search shows `Tìm bằng ảnh đang tạm ngưng. Bạn thử mô tả bằng
  chữ nhé.` The page never breaks.
- **AC5** One client can run at most 20 searches a minute per shop, and a shop at most 120 a minute
  overall; over that, the bar shows `Bạn tìm hơi nhanh rồi. Vui lòng thử lại sau một phút.`
- **AC6** Works at 375 px width (no horizontal scroll, the photo button and remove button are at least
  44 px), and the photo is shrunk in the browser before upload.

### Assumptions (proposed, need PO approval)

- **A1** The search photo is not stored: it is sent to the search service and dropped (unlike PB-30
  chat photos, A10 there).
- **A2** Group, size and sort controls are reset when a description or photo search runs; they apply
  again after `Xóa tìm kiếm`.
- **A3** No change to the AI assistant: `Hỏi trợ lý AI` passes only the text (sending the photo to
  chat is PB-30's job).
- **A4** At most 10 results (the PB-30 service limit).
- **A5** Only the web shop page; Messenger/Telegram are unchanged.

### Notes

- Depends on PB-30 for the embedding service and the indexed vectors; built and testable without it
  (mock adapter, section 3.4). Going live needs PB-30 merged and the Task 9 integration of the plan.
- DoD checks: Core · Data · UI (rate-limit migration and its RLS/grant test; 375 px phone check).

## 2. Technical requirements

- **R1** No new model, vector store or index: reuse PB-30's `embedder/` service, Qdrant collection and
  `DOC_FORMAT_VERSION = "v1"` documents. No Redis, queue or cache (same as PB-30 R4).
- **R2** The shop id sent to the search service always comes from the server (`findShop(slug)`).
- **R3** The browser never calls the search service; it calls `POST /api/shops/[slug]/search`.
- **R4** Until PB-30 is merged, code only depends on PB-30 through `src/lib/search/pb30-shim.ts` and the
  wire contract in `src/lib/search/embedder-contract.ts`. No file that PB-30 creates or changes is
  created or changed by PB-34 before Task 9.

## 3. Contract with PB-30

Owners: PB-30 (embedder, photo rules) and PB-34 (search bar). Both sides keep this section true; a
change needs both owners on the PR.

### 3.1 Wire contract: `POST {EMBEDDER_URL}/search`

Header `Authorization: Bearer <EMBEDDER_TOKEN>`. Body (camelCase):

| field | type | rule |
|---|---|---|
| `shopId` | uuid string | required |
| `imageBase64` | string \| null | optional; standard base64, decoded ≤ 5 MB |
| `mediaType` | `"image/jpeg" \| "image/png" \| "image/webp"` \| null | required iff `imageBase64` is set |
| `text` | string \| null | optional; 1–200 chars after trim |
| `limit` | int 1..10 | default 5 |

- At least one of `imageBase64` and `text` is set, else **422**.
- **200** `{"hits": [{"productId": str, "score": float}], "model": "google/embeddinggemma-2", "dim": 768}`;
  hits are of `shopId` only, sorted by `score` descending, `len(hits) <= limit`.
- **401** missing/wrong token · **422** invalid body · **400** `{"error": "bad_image"}`.
- **Today (PB-30 as built, `embedder/shopmate_embedder/api.py`):** `imageBase64` and `mediaType` are
  required. Every request valid today stays valid (backward compatible). The only change is that a
  text-only request becomes valid (C2).
- Fixtures: `src/lib/search/contract-fixtures/*.json` are the shared examples. PB-34 tests its Zod
  schemas against them; Task 9 adds a pytest in `embedder/tests/test_contract_fixtures.py` that sends each
  `request-*.json` to `create_app` and checks the status named in the file.

### 3.2 Changes requested of PB-30 (C1–C3)

- **C1 Freeze:** until PB-34 Task 9, PB-30 does not rename or remove any field above, the `/search`
  path, the auth header, or the response keys.
- **C2 Text-only query:** `formatting.query_input(image: Image | None, text: str | None)` returns the
  plain string `"task: search result | query: <text>"` when `image is None`; `Embedder.embed_query`
  accepts `image=None`; `SearchBody.image_base64`/`media_type` become optional with a validator for the
  rules above. Done by PB-34 Task 9 after PB-30 is merged (so PB-30 does not wait on PB-34), unless the
  PB-30 owner prefers to ship it in PB-30.
- **C3 Index unchanged:** text queries search the same points as photo queries. Any change to
  `DOC_FORMAT_VERSION` or the collection name is announced to PB-34, which then re-runs Task 9 Step 5
  (calibration).

### 3.3 Shared TypeScript names (from the PB-30 plan, Tasks 5, 6, 9)

PB-34 uses these names exactly, through `src/lib/search/pb30-shim.ts`, which re-implements them until
PB-30 is merged and then becomes re-exports (Task 9):

- `@/contract`: `PHOTO_MEDIA_TYPES`, `PhotoMediaType`, `MAX_PHOTO_BYTES = 5 * 1024 * 1024`,
  `PhotoInput = { base64: string; mediaType: PhotoMediaType }`.
- `@/lib/chat/photo-rules`: `PHOTO_ERRORS = { type: "Chỉ gửi được ảnh JPEG, PNG hoặc WebP.", size: "Ảnh
  tối đa 5 MB.", read: "Không đọc được ảnh. Vui lòng chọn ảnh khác." }`, `checkPhoto(bytes: Uint8Array)`.
- `@/lib/chat/prepare-photo`: `preparePhoto(file: File): Promise<{ ok: true; blob: Blob } | { ok: false;
  error: string }>`.
- Env: `EMBEDDER_URL`, `EMBEDDER_TOKEN` (empty `EMBEDDER_URL` = service off).

### 3.4 Mock (until PB-30 is merged)

`SEARCH_EMBEDDER_MOCK=1` (ignored when `NODE_ENV=production`) swaps the HTTP client for an in-process
mock that implements the same port: text queries score products by word overlap with name, category,
description and colors; photo queries return the shop's first products with descending scores. Both
return scores in [0, 1] so the floor of section 3.5 applies.

### 3.5 Score floors

`DESCRIPTION_MIN_SCORE` and `PHOTO_MIN_SCORE` live in `src/lib/search/rank.ts`. Until Task 9 Step 5 they
are placeholders (`0.5`, tuned for the mock). Task 9 sets them from a calibration run on the eval shop,
recorded in `embedder/CALIBRATION.md` next to PB-30's photo thresholds. Text queries need their own floor
because text-to-document scores do not share the photo-query distribution.
