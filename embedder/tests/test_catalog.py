"""Tests for catalog reads from Supabase PostgREST (httpx.MockTransport, no network)."""

import uuid

import httpx
import pytest

from shopmate_embedder.catalog import CatalogReader

SECRET = "service-role-key"
SUPABASE_URL = "http://supabase.test"

# Two catalog rows: the first with duplicated variant colors, the second
# with no colors and no image at all.
ROWS = [
    {
        "id": str(uuid.uuid4()),
        "code": "AO-001",
        "name": "Áo thun cotton",
        "category": "Áo thun",
        "description": "Cotton 100%.",
        "image_url": "http://images.test/ao-001.png",
        "variants": [{"color": "Trắng"}, {"color": "Đen"}, {"color": "Trắng"}],
    },
    {
        "id": str(uuid.uuid4()),
        "code": "QP-001",
        "name": "Quần jeans",
        "category": None,
        "description": None,
        "image_url": None,
        "variants": None,
    },
]


def test_products_reads_shop_rows_with_secret_key_and_distinct_colors():
    shop_id = str(uuid.uuid4())
    shop_requests: list[httpx.Request] = []
    product_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/rest/v1/shops"):
            shop_requests.append(request)
            assert request.url.params["slug"] == "eq.hanh-boutique"
            return httpx.Response(200, json=[{"id": shop_id}])
        product_requests.append(request)
        assert request.url.params["shop_id"] == f"eq.{shop_id}"
        assert request.url.params["select"] == (
            "id,code,name,category,description,image_url,variants(color)"
        )
        return httpx.Response(200, json=ROWS)

    reader = CatalogReader(
        httpx.Client(transport=httpx.MockTransport(handler)), SUPABASE_URL, SECRET
    )

    assert reader.shop_id("hanh-boutique") == shop_id
    docs = reader.products(shop_id)

    assert len(shop_requests) == 1
    assert len(product_requests) == 1
    for request in shop_requests + product_requests:
        assert request.headers["apikey"] == SECRET
        assert request.headers["authorization"] == f"Bearer {SECRET}"

    assert len(docs) == 2
    first, second = docs
    assert first.product_id == ROWS[0]["id"]
    assert first.shop_id == shop_id
    assert first.code == "AO-001"
    assert first.name == "Áo thun cotton"
    assert first.category == "Áo thun"
    assert first.description == "Cotton 100%."
    # Distinct variant colors in first-seen order; the photo is loaded later.
    assert first.colors == ["Trắng", "Đen"]
    assert first.image is None
    assert second.colors == []
    assert second.image is None


def test_shop_id_unknown_slug_raises_lookup_error():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/rest/v1/shops")
        return httpx.Response(200, json=[])

    reader = CatalogReader(
        httpx.Client(transport=httpx.MockTransport(handler)), SUPABASE_URL, SECRET
    )
    with pytest.raises(LookupError):
        reader.shop_id("no-such-shop")
