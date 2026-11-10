# ProductVectors behaviour against in-memory Qdrant, dim 4.
# Point ids must be valid UUIDs (Qdrant rule; prod ids are Supabase uuids).
import pytest
from qdrant_client import QdrantClient
from qdrant_client import models as qm

from shopmate_embedder.formatting import ProductDoc
from shopmate_embedder.vectors import ProductVectors

COLLECTION = "shopmate_products_test"
VEC_A = [1.0, 0.0, 0.0, 0.0]
VEC_B = [0.0, 1.0, 0.0, 0.0]

ID_A_KEEP = "00000000-0000-0000-0000-000000000001"
ID_A_GONE = "00000000-0000-0000-0000-000000000002"
ID_B = "00000000-0000-0000-0000-000000000003"
ID_REPLACE = "00000000-0000-0000-0000-000000000004"


def doc(product_id: str, shop_id: str, code: str, name: str | None = None) -> ProductDoc:
    return ProductDoc(product_id, shop_id, code, name or f"{code} name", None, None, [], image=None)


@pytest.fixture
def client() -> QdrantClient:
    return QdrantClient(":memory:")


@pytest.fixture
def vectors(client: QdrantClient) -> ProductVectors:
    pv = ProductVectors(client, COLLECTION, dim=4)
    pv.ensure_collection()
    return pv


def test_ensure_collection_creates_and_is_idempotent(client: QdrantClient):
    pv = ProductVectors(client, COLLECTION, dim=4)
    pv.ensure_collection()
    pv.ensure_collection()  # second call: no error
    assert client.collection_exists(COLLECTION)


def test_ensure_collection_rejects_other_dimension(client: QdrantClient):
    client.create_collection(COLLECTION, vectors_config=qm.VectorParams(size=8, distance=qm.Distance.COSINE))
    pv = ProductVectors(client, COLLECTION, dim=4)
    with pytest.raises(ValueError):
        pv.ensure_collection()


def test_search_only_returns_own_shop(vectors: ProductVectors):
    vectors.upsert([doc(ID_A_KEEP, "A", "A1")], [VEC_A])
    vectors.upsert([doc(ID_B, "B", "B1")], [VEC_A])  # identical vector, other shop
    hits = vectors.search("A", VEC_A, 5)
    assert [h.product_id for h in hits] == [ID_A_KEEP]


def test_upsert_uses_product_id_as_point_id_and_replaces(vectors: ProductVectors, client: QdrantClient):
    vectors.upsert([doc(ID_REPLACE, "A", "C1")], [VEC_A])
    vectors.upsert([doc(ID_REPLACE, "A", "C1", name="renamed")], [VEC_B])
    assert client.count(COLLECTION, exact=True).count == 1
    (record,) = client.retrieve(COLLECTION, ids=[ID_REPLACE], with_payload=True)
    assert record.payload == {
        "shop_id": "A",
        "product_id": ID_REPLACE,
        "code": "C1",
        "name": "renamed",
        "doc_version": "v1",
    }


def test_remove_except_deletes_only_that_shops_missing_products(vectors: ProductVectors, client: QdrantClient):
    vectors.upsert([doc(ID_A_KEEP, "A", "A1"), doc(ID_A_GONE, "A", "A2")], [VEC_A, VEC_A])
    vectors.upsert([doc(ID_B, "B", "B1")], [VEC_A])
    removed = vectors.remove_except("A", {ID_A_KEEP})
    assert removed == 1
    leftovers = client.retrieve(COLLECTION, ids=[ID_A_KEEP, ID_A_GONE], with_payload=False)
    assert {p.id for p in leftovers} == {ID_A_KEEP}
    assert [h.product_id for h in vectors.search("B", VEC_A, 5)] == [ID_B]
