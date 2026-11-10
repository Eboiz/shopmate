"""Offline flow: index shop catalogs into Qdrant (the shopmate-index CLI).

CLI run by hand after `pnpm db:seed` or a catalog edit; no queue, no Redis.
"""

import argparse
import urllib.parse
from dataclasses import dataclass

import httpx
from qdrant_client import QdrantClient

from shopmate_embedder.catalog import CatalogReader, load_image
from shopmate_embedder.config import Settings
from shopmate_embedder.model import Embedder, GemmaEmbedder
from shopmate_embedder.vectors import ProductVectors

PROD_COLLECTION = "shopmate_products"
DEV_COLLECTION = "shopmate_products_dev"
LOCAL_HOSTS = {"localhost", "127.0.0.1"}


@dataclass
class IndexReport:
    """Per-shop result: doc counts plus points removed afterwards."""

    shop_id: str
    indexed: int
    without_image: int
    removed: int


def index_shop(
    slug: str,
    *,
    reader: CatalogReader,
    http: httpx.Client,
    embedder: Embedder,
    vectors: ProductVectors,
    batch_size: int = 16,
) -> IndexReport:
    """Read a shop's catalog, embed it, and replace its points in Qdrant."""
    shop_id = reader.shop_id(slug)
    vectors.ensure_collection()
    docs = reader.products(shop_id)
    for doc in docs:
        doc.image = load_image(http, reader.image_urls.get(doc.product_id))
    without_image = sum(doc.image is None for doc in docs)
    for start in range(0, len(docs), batch_size):
        batch = docs[start : start + batch_size]
        vectors.upsert(batch, embedder.embed_documents(batch))
    removed = vectors.remove_except(shop_id, {doc.product_id for doc in docs})
    return IndexReport(
        shop_id=shop_id, indexed=len(docs), without_image=without_image, removed=removed
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="shopmate-index", description="Index shop catalogs into Qdrant."
    )
    parser.add_argument("--shop", action="append", required=True, metavar="SLUG")
    args = parser.parse_args(argv)

    settings = Settings.from_env()
    host = urllib.parse.urlparse(settings.supabase_url or "").hostname or ""
    # Guard FIRST: refuse before any model or Qdrant client is built.
    if settings.qdrant_collection == PROD_COLLECTION and host in LOCAL_HOSTS:
        print(
            f"Refusing to index {PROD_COLLECTION!r} from local Supabase ({host}); "
            f"use QDRANT_COLLECTION={DEV_COLLECTION} instead."
        )
        return 2
    missing = [
        name
        for name in ("QDRANT_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY")
        if not getattr(settings, name.lower())
    ]
    if missing:
        print(f"Missing environment variables: {', '.join(missing)}. See .env.example.")
        return 2

    embedder = GemmaEmbedder()
    vectors = ProductVectors(
        QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key),
        settings.qdrant_collection,
        embedder.dim,
    )
    failures = 0
    with httpx.Client() as http:
        reader = CatalogReader(http, settings.supabase_url, settings.supabase_secret_key)
        for slug in args.shop:
            try:
                report = index_shop(
                    slug, reader=reader, http=http, embedder=embedder, vectors=vectors
                )
            except LookupError as exc:
                failures += 1
                print(exc)
                continue
            print(
                f"{slug}: indexed={report.indexed} "
                f"without_image={report.without_image} removed={report.removed}"
            )
    return 1 if failures else 0
