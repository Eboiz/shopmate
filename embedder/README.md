# Shopmate embedder

Wraps `google/embeddinggemma-2` (768-dim, `normalize_embeddings=True`) and stores
per-shop product vectors in Qdrant Cloud (cosine distance) for PB-30 photo and
text product search.

## Setup

```bash
cd embedder
uv sync                 # CPU-only torch, ~1 GB of packages; weights (~1.5 GB) land in $HF_HOME on first use
cp .env.example .env    # then fill in the values
uv run ruff check && uv run pytest -q
```

## Collections

`QDRANT_COLLECTION` must be `shopmate_products` on prod only; use
`shopmate_products_dev` for everything else (local dev, CI, eval).

## Offline flow

Index a shop's catalog into Qdrant by hand after `pnpm db:seed` (an initial
seed) or after any catalog edit:

```bash
uv run shopmate-index --shop hanh-boutique --shop hanh-boutique-eval
```

The first run downloads the ~1.5 GB of `google/embeddinggemma-2` weights into
`$HF_HOME`. It prints one line per shop (`indexed`, `without_image`,
`removed`) and exits 0 on success, 1 if a slug is unknown, 2 on missing env
vars. The CLI refuses `QDRANT_COLLECTION=shopmate_products` when
`SUPABASE_URL` points at localhost/127.0.0.1 — seed shop IDs are the same
locally and on the shared project, so writing seed data into the prod
collection from a local run would poison it.
