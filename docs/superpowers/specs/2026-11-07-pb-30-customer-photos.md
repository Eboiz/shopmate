# PB-30 Customer photos in chat — spec

Source: [Eboiz/Documents#31](https://github.com/Eboiz/Documents/issues/31) (copied 07/11/2026), plus the
developer's technical requirements for photo search (section 2).

## 1. Story (Eboiz/Documents#31)

**As Thảo**, I want to send the shop a photo of an item (a screenshot from Facebook, a photo of a friend's
outfit) and ask about it, **so that** I don't have to describe it in words.

### Acceptance criteria

- **AC1** On web chat, Thảo can add a photo by pasting it (Ctrl+V) into the message box or by picking a file.
  A preview shows before sending and can be removed. Only JPEG, PNG and WebP up to 5 MB are accepted; anything
  else shows a clear message in Vietnamese.
- **AC2** Photos sent on Messenger and Telegram reach the AI. Today they are turned into the text
  `[Khách gửi ảnh] <url>` (`src/lib/channels/receive.ts`), so the model never sees them. Messenger photo URLs
  expire and Telegram only gives a `file_id` (resolved with `getFile`), so the server downloads each photo
  right away and stores it in Supabase Storage under the shop. The conversation keeps the stored photo, and
  staff see it in the inbox (PB-13).
- **AC3** The AI looks at the photo, describes the item (type, color, style), and looks it up in the shop's
  catalog with `search_products`. The match is a product from the tool result, never the model's own claim
  that the shop sells this item. Price, stock and size still come only from tools (PB-05, PB-06), and the
  post-check (PB-07) covers these replies.
- **AC4** When a product matches, the reply names it and shows its product card from data, like any other
  product answer.
- **AC5** When nothing matches exactly, the AI shows up to 3 similar items from `search_products` (same type
  or color) as product cards, and asks Thảo to describe the item more or whether she wants a staff member to
  advise her directly. If she says yes, `handoff_to_staff` runs with reason `asked_for_human`. If her next
  message still matches nothing, the existing "not understood twice" handoff (PB-14) applies.
- **AC6** A photo that shows no clothing (a selfie, a screenshot of text, a payment receipt) gets a short reply
  asking what she wants to know; the AI does not guess a product from it. Text inside a photo is treated as
  content, never as instructions.
- **AC7** A photo counts as one message for the rate limit (PB-17). A message with both a photo and text sends
  both to the AI in the same turn.
- **AC8** The eval set gets at least 6 photo cases (exact match, similar items only, no clothing, photo +
  text), run on the eval shop.

### Assumptions (approved by the PO, 07/11/2026)

- **A9** When a photo matches no product exactly, the AI shows up to 3 similar items and asks for more detail
  or offers a staff member; it never says the shop has the item.
- **A10** Photos are stored in Supabase Storage for the conversation history; the original channel URL is not
  kept.

### Notes

- Adds image content to the engine input and the conversation history, which changes the PB-00 contract (#25):
  approved by all three contract owners.
- Staff reply assistant (PB-20, `staff_draft` mode) is out of scope.
- Definition of Done: Core · AI · Data · UI checks of the issue apply (RLS test with two shops, generated
  types committed, 375 px phone check, eval not lower than `main`, prompt version bumped).

## 2. Photo search: technical requirements (developer, 07/11/2026)

- **R1 Embedding model:** `google/embeddinggemma-2`, loaded **without the audio encoder**
  (`config_kwargs={"audio_config": None}`: text + image, ~440M parameters). Built first, before the rest of
  PB-30.
- **R2 Vector store:** Qdrant Cloud.
- **R3 No reranker for now.** Add one later only if search results are not good enough (the calibration in
  the plan is where that is decided).
- **R4 Keep it simple:** no Redis, Kafka or other queue/cache infrastructure.
- **R5 Two flows:**
  - **offline**: index each shop's catalog (product photo + name, category, description, colors) into Qdrant;
  - **online**: at chat time, embed the shopper's photo and search the shop's vectors.
- **R6 Hosting:** the embedding service runs on **Modal** (it can't run on Vercel).
