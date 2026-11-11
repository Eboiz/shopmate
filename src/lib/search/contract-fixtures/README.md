PB-30/PB-34 contract fixtures for `POST {EMBEDDER_URL}/search` (spec section 3.1).
Each `request-*.json` is `{ "expectStatus": 200 | 422, "body": ... }`: the status the embedder must return for that body.
`response-ok.json` is a full 200 body.
PB-34 tests its Zod schemas against these files.
Task 8 runs every `request-*.json` against the Python embedder and checks `expectStatus`.
