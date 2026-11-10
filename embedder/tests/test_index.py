"""Tests for the offline indexing CLI (in-memory Qdrant, MockTransport, no network)."""

import io
import logging
import uuid

import httpx
import pytest
from PIL import Image
from qdrant_client import QdrantClient

from shopmate_embedder import index
from shopmate_embedder.catalog import CatalogReader
from shopmate_embedder.formatting import ProductDoc
from shopmate_embedder.vectors import ProductVectors

SECRET = "service-role-key"
SUPABASE_URL = "http://supabase.test"
COLLECTION = "test_products"


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(buffer, format="PNG")
    return buffer.getvalue()


def _row(code: str, color: str, *, with_image: bool) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "code": code,
        "name": f"Sản phẩm {code}",
        "category": "Áo thun",
        "description": "Cotton 100%.",
        "image_url": f"http://images.test/{code}.png" if with_image else None,
        "variants": [{"color": color}],
    }


class _StubSupabase:
    """PostgREST stub: /shops by slug, /products rows, and image URLs.

    Image URLs in `image_statuses` answer with the given status; every other
    non-REST path answers with valid PNG bytes.
    """

    def __init__(
        self, shop_id: str, rows: list[dict], *, image_statuses: dict[str, int] | None = None
    ):
        self.shop_id = shop_id
        self.rows = rows
        self.image_statuses = image_statuses or {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rest/v1/shops"):
            assert request.headers["authorization"] == f"Bearer {SECRET}"
            return httpx.Response(200, json=[{"id": self.shop_id}])
        if request.url.path.endswith("/rest/v1/products"):
            return httpx.Response(200, json=self.rows)
        status = self.image_statuses.get(str(request.url))
        if status is not None:
            return httpx.Response(status, text="not found")
        return httpx.Response(200, content=_png_bytes())

    def reader(self) -> CatalogReader:
        return CatalogReader(self.client(), SUPABASE_URL, SECRET)

    def image_client(self) -> httpx.Client:
        return self.client()

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


def _vectors() -> tuple[ProductVectors, QdrantClient]:
    client = QdrantClient(":memory:")
    return ProductVectors(client, COLLECTION, dim=4), client


def test_index_shop_upserts_every_product_and_counts_missing_images(
    fake_embedder, caplog: pytest.LogCaptureFixture
):
    shop_id = str(uuid.uuid4())
    rows = [_row("AO-001", "Trắng", with_image=True), _row("AO-002", "Đen", with_image=True), _row("AO-003", "Xanh", with_image=True)]
    stub = _StubSupabase(
        shop_id,
        rows,
        image_statuses={"http://images.test/AO-002.png": 404},
    )
    vectors, client = _vectors()

    with caplog.at_level(logging.WARNING):
        report = index.index_shop(
            "hanh-boutique",
            reader=stub.reader(),
            http=stub.image_client(),
            embedder=fake_embedder,
            vectors=vectors,
        )

    assert report == index.IndexReport(shop_id=shop_id, indexed=3, without_image=1, removed=0)
    assert client.count(COLLECTION, exact=True).count == 3

    # The 404 product is embedded text-only: its stored vector is the vector
    # FakeEmbedder would compute for that doc with no image.
    doomed = rows[1]
    point = client.retrieve(COLLECTION, ids=[doomed["id"]], with_vectors=True)[0]
    text_only_doc = ProductDoc(
        product_id=doomed["id"],
        shop_id=shop_id,
        code=doomed["code"],
        name=doomed["name"],
        category=doomed["category"],
        description=doomed["description"],
        colors=["Đen"],
        image=None,
    )
    expected = fake_embedder.embed_documents([text_only_doc])[0]
    assert point.vector == pytest.approx(expected)

    assert any(
        record.levelno == logging.WARNING and "AO-002" in record.getMessage()
        for record in caplog.records
    )


def test_index_shop_removes_points_of_products_no_longer_in_catalog(fake_embedder):
    shop_id = str(uuid.uuid4())
    rows = [_row("AO-001", "Trắng", with_image=False), _row("AO-002", "Đen", with_image=False), _row("AO-003", "Xanh", with_image=False)]
    stub = _StubSupabase(shop_id, rows)
    vectors, client = _vectors()

    first = index.index_shop(
        "hanh-boutique",
        reader=stub.reader(),
        http=stub.image_client(),
        embedder=fake_embedder,
        vectors=vectors,
    )
    assert first == index.IndexReport(shop_id=shop_id, indexed=3, without_image=3, removed=0)
    assert client.count(COLLECTION, exact=True).count == 3

    # Catalog edit: one product is gone, so its point must be removed.
    stub.rows = rows[:2]
    second = index.index_shop(
        "hanh-boutique",
        reader=stub.reader(),
        http=stub.image_client(),
        embedder=fake_embedder,
        vectors=vectors,
    )
    assert second == index.IndexReport(shop_id=shop_id, indexed=2, without_image=2, removed=1)
    assert client.count(COLLECTION, exact=True).count == 2


def test_cli_refuses_prod_collection_for_local_supabase(monkeypatch: pytest.MonkeyPatch, capsys):
    for name in ("QDRANT_URL", "QDRANT_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "QDRANT_COLLECTION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("QDRANT_URL", "https://prod.qdrant.io")
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", SECRET)
    monkeypatch.setenv("QDRANT_COLLECTION", "shopmate_products")

    def forbidden(*args, **kwargs):
        raise AssertionError("must never build the model or the Qdrant client")

    monkeypatch.setattr(index, "GemmaEmbedder", forbidden)
    monkeypatch.setattr(index, "QdrantClient", forbidden)

    assert index.main(["--shop", "hanh-boutique"]) == 2
    output = capsys.readouterr()
    assert "shopmate_products_dev" in output.out + output.err
