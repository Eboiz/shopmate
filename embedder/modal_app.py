"""Modal deployment: the /search API service and offline catalog indexing.

Deploy the API: `modal deploy embedder/modal_app.py`.
Index shared-Supabase shops: `modal run embedder/modal_app.py --shop <slug>`.
Local Supabase shops must be indexed with the `shopmate-index` CLI instead
(Modal cannot reach a local Supabase). Not covered by unit tests.
"""

import modal

from shopmate_embedder.index import IndexReport

app = modal.App("shopmate-embedder")

# Pinned to uv.lock; torch comes from the CPU index to keep the image small
# (the class runs on CPU; see the gpu note below).
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "sentence-transformers==6.2.0",
        "transformers==5.22.2",
        "torch==2.15.0",
        "pillow==13.0.0",
        "qdrant-client==1.20.0",
        "fastapi==0.162.2",
        "httpx==0.28.1",
        extra_index_url="https://download.pytorch.org/whl/cpu",
    )
    .env({"HF_HOME": "/cache"})
    # Last: in modal 1.6.3 an .env() after add_local_python_source raises InvalidError.
    .add_local_python_source("shopmate_embedder")
)

volume = modal.Volume.from_name("shopmate-hf-cache", create_if_missing=True)
secret = modal.Secret.from_name("shopmate-embedder")


@app.cls(
    image=image,
    secrets=[secret],
    volumes={"/cache": volume},
    cpu=4.0,
    memory=8192,
    scaledown_window=600,
    timeout=120,
    # CPU first; gpu="T4" is the fallback only if the smoke test shows warm p95 > 3 s.
)
class EmbedderService:
    """Serves the same FastAPI app that local dev runs with uvicorn."""

    @modal.enter()
    def load(self) -> None:
        from shopmate_embedder.api import app_from_env

        self._app = app_from_env()

    @modal.asgi_app()
    def api(self):
        return self._app


@app.function(image=image, secrets=[secret], volumes={"/cache": volume}, timeout=1800)
def index_shops(slugs: list[str]) -> list[IndexReport]:
    """Index the shared Supabase catalog for the given shop slugs; offline flow."""
    import httpx
    from qdrant_client import QdrantClient

    from shopmate_embedder.catalog import CatalogReader
    from shopmate_embedder.config import Settings
    from shopmate_embedder.index import index_shop
    from shopmate_embedder.model import GemmaEmbedder
    from shopmate_embedder.vectors import ProductVectors

    settings = Settings.from_env()
    embedder = GemmaEmbedder()
    vectors = ProductVectors(
        QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key),
        settings.qdrant_collection,
        embedder.dim,
    )
    reports = []
    with httpx.Client() as http:
        reader = CatalogReader(http, settings.supabase_url, settings.supabase_secret_key)
        for slug in slugs:
            report = index_shop(
                slug, reader=reader, http=http, embedder=embedder, vectors=vectors
            )
            print(
                f"{slug}: indexed={report.indexed} "
                f"without_image={report.without_image} removed={report.removed}"
            )
            reports.append(report)
    return reports


@app.local_entrypoint()
def main(shop: str) -> None:
    """`modal run embedder/modal_app.py --shop <slug>` prints one IndexReport per shop."""
    for report in index_shops.remote([shop]):
        print(report)
