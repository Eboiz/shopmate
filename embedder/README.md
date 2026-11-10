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

## Hosting on molab (GPU)

`molab_embedder.py` is a marimo notebook that hosts this API on molab's RTX Pro 6000: it
clones this branch, installs the package (plus `uvicorn`) with CUDA torch into a venv
(`uv pip install --no-sources -e embedder`), optionally indexes shops, starts uvicorn on
`127.0.0.1:8008`, opens a Cloudflare quick tunnel and runs a `/search` smoke test through it.

Set these as molab secrets (environment variables):

- `GITHUB_TOKEN` (read access to `Eboiz/shopmate`)
- `HF_TOKEN` (account has accepted the EmbeddingGemma license)
- `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION` (`shopmate_products_dev` unless prod)
- `EMBEDDER_TOKEN` (same value the web app sends)
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (shared project; needed to index and smoke test)

Run order: open the notebook on molab, run all cells, then copy the printed
`EMBEDDER_URL=https://xxx.trycloudflare.com` and set it, plus `EMBEDDER_TOKEN`, in the web
app's environment (`.env.local` or Vercel), then restart/redeploy the app.

Indexing is off by default: set `RUN_INDEX = True` and list the shop slugs in
`SHOPS_TO_INDEX` in the notebook's config cell.

Notes:

- The `trycloudflare.com` URL changes on every tunnel restart, so `EMBEDDER_URL` must be
  updated (and the app restarted) each time.
- Re-running the API cell also restarts the tunnel, so `EMBEDDER_URL` changes again.
- The first run downloads ~1.5 GB of `google/embeddinggemma-2` weights into
  `/marimo/work/hf-cache`.
- The molab session sleeps when idle, and the tunnel dies with it.
- The web app only needs `EMBEDDER_URL` and `EMBEDDER_TOKEN` to reach this host.
