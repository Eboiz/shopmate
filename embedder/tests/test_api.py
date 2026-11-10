# /search + /health behaviour: create_app + TestClient, FakeEmbedder, in-memory Qdrant.
# Never loads the real model; the RecordingEmbedder below subclasses FakeEmbedder as is.
import base64
import uuid
from io import BytesIO

import pytest
from conftest import RED_PNG, FakeEmbedder
from fastapi.testclient import TestClient
from PIL import Image
from qdrant_client import QdrantClient

from shopmate_embedder.api import create_app
from shopmate_embedder.formatting import ProductDoc
from shopmate_embedder.model import MODEL_ID
from shopmate_embedder.vectors import ProductVectors

COLLECTION = "shopmate_products_test"
TOKEN = "test-token"
TEXT = "áo đỏ"

SHOP_A = str(uuid.uuid4())
SHOP_B = str(uuid.uuid4())
ID_A = str(uuid.uuid4())
ID_B = str(uuid.uuid4())


class RecordingEmbedder(FakeEmbedder):
    """FakeEmbedder that records embed_query calls along with the image and text."""

    def __init__(self):
        self.queries: list[tuple[Image.Image, str | None]] = []

    def embed_query(self, image: Image.Image, text: str | None) -> list[float]:
        self.queries.append((image, text))
        return super().embed_query(image, text)


def png_b64(image: Image.Image) -> str:
    buf = BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def payload(
    shop_id: str, image_b64: str | None = None, text: str | None = None, limit: int = 5
) -> dict:
    body = {
        "shopId": shop_id,
        "imageBase64": png_b64(RED_PNG) if image_b64 is None else image_b64,
        "mediaType": "image/png",
        "limit": limit,
    }
    if text is not None:
        body["text"] = text
    return body


def doc(product_id: str, shop_id: str, code: str) -> ProductDoc:
    return ProductDoc(
        product_id, shop_id, code, f"{code} name", None, None, [], image=None
    )


@pytest.fixture
def vectors() -> ProductVectors:
    pv = ProductVectors(QdrantClient(":memory:"), COLLECTION, FakeEmbedder.dim)
    pv.ensure_collection()
    return pv


@pytest.fixture
def embedder() -> RecordingEmbedder:
    return RecordingEmbedder()


@pytest.fixture
def client(embedder: RecordingEmbedder, vectors: ProductVectors) -> TestClient:
    return TestClient(create_app(embedder, vectors, TOKEN))


def seed(vectors: ProductVectors, fake: FakeEmbedder, text: str | None) -> None:
    # Same vector in both shops so only the shop filter decides what comes back.
    query_vector = fake.embed_query(RED_PNG, text)
    vectors.upsert([doc(ID_A, SHOP_A, "A1")], [query_vector])
    vectors.upsert([doc(ID_B, SHOP_B, "B1")], [query_vector])


def test_search_requires_bearer_token(client: TestClient, vectors: ProductVectors, fake_embedder):
    seed(vectors, fake_embedder, TEXT)
    # No Authorization header at all.
    assert client.post("/search", json=payload(SHOP_A, text=TEXT)).status_code == 401
    # Wrong bearer token (same length, so the comparison has to be constant-time).
    token_header = {"Authorization": f"Bearer {'x' * len(TOKEN)}"}
    assert (
        client.post("/search", json=payload(SHOP_A, text=TEXT), headers=token_header).status_code
        == 401
    )
    # A different scheme must be rejected even with the correct token.
    # "Basic" is 6 chars, but a 7-char non-Bearer prefix ("Xxxxxx ") is what
    # the old strip-first-7-chars bug accepted with the correct token.
    for scheme in ("Basic", "Xxxxxx"):
        assert (
            client.post(
                "/search",
                json=payload(SHOP_A, text=TEXT),
                headers={"Authorization": f"{scheme} {TOKEN}"},
            ).status_code
            == 401
        )
    # The bare token without the "Bearer " scheme must be rejected too.
    assert (
        client.post(
            "/search", json=payload(SHOP_A, text=TEXT), headers={"Authorization": TOKEN}
        ).status_code
        == 401
    )


def test_search_returns_hits_of_requested_shop_only(client, vectors, fake_embedder):
    seed(vectors, fake_embedder, TEXT)
    response = client.post(
        "/search", json=payload(SHOP_A, text=TEXT), headers={"Authorization": f"Bearer {TOKEN}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == MODEL_ID
    assert body["dim"] == FakeEmbedder.dim
    (hit,) = body["hits"]
    assert hit["productId"] == ID_A
    assert hit["score"] == pytest.approx(1.0)


def test_search_passes_text_to_query_embedding(client, embedder, vectors, fake_embedder):
    seed(vectors, fake_embedder, TEXT)
    response = client.post(
        "/search", json=payload(SHOP_A, text=TEXT), headers={"Authorization": f"Bearer {TOKEN}"}
    )
    assert response.status_code == 200
    assert len(embedder.queries) == 1
    image, text = embedder.queries[0]
    assert text == TEXT
    # The decoded image is RGB and keeps its size; nothing else reaches the embedder.
    assert image.size == RED_PNG.size
    assert image.mode == "RGB"


def test_search_rejects_undecodable_image_with_400_bad_image(client):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    # Not valid base64.
    bad_base64 = client.post("/search", json=payload(SHOP_A, image_b64="!!!not base64!!!"), headers=headers)
    # Valid base64 of bytes PIL cannot decode.
    garbage = client.post(
        "/search", json=payload(SHOP_A, image_b64=base64.b64encode(b"not an image").decode()), headers=headers
    )
    for response in (bad_base64, garbage):
        assert response.status_code == 400
        assert response.json() == {"error": "bad_image"}


def test_search_limit_out_of_range_is_422(client):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    assert client.post("/search", json=payload(SHOP_A, limit=0), headers=headers).status_code == 422
    assert client.post("/search", json=payload(SHOP_A, limit=11), headers=headers).status_code == 422


def test_health_needs_no_token(client):
    response = client.get("/health")  # no Authorization header
    assert response.status_code == 200
    assert response.json() == {"ok": True, "model": MODEL_ID}
