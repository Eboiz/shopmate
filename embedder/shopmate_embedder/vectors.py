"""Product vectors in Qdrant: one collection, cosine distance, shop-scoped search."""

from dataclasses import dataclass

from qdrant_client import QdrantClient
from qdrant_client import models as qm

from shopmate_embedder.formatting import DOC_FORMAT_VERSION, ProductDoc


@dataclass
class Hit:
    product_id: str
    score: float


class ProductVectors:
    def __init__(self, client: QdrantClient, collection: str, dim: int):
        self.client = client
        self.collection = collection
        self.dim = dim

    def ensure_collection(self) -> None:
        """Create the collection (cosine) and the shop_id tenant index; no-op if it exists."""
        if self.client.collection_exists(self.collection):
            size = self.client.get_collection(self.collection).config.params.vectors.size
            if size != self.dim:
                raise ValueError(
                    f"collection {self.collection!r} has dim {size}, expected {self.dim}"
                )
            return
        self.client.create_collection(
            collection_name=self.collection,
            vectors_config=qm.VectorParams(size=self.dim, distance=qm.Distance.COSINE),
        )
        self.client.create_payload_index(
            collection_name=self.collection,
            field_name="shop_id",
            field_schema=qm.KeywordIndexParams(type=qm.KeywordIndexType.KEYWORD, is_tenant=True),
        )

    def upsert(self, docs: list[ProductDoc], vectors: list[list[float]]) -> None:
        """Store each doc keyed by its product id; re-upserting replaces in place."""
        points = [
            qm.PointStruct(
                id=doc.product_id,
                vector=vector,
                payload={
                    "shop_id": doc.shop_id,
                    "product_id": doc.product_id,
                    "code": doc.code,
                    "name": doc.name,
                    "doc_version": DOC_FORMAT_VERSION,
                },
            )
            for doc, vector in zip(docs, vectors, strict=True)
        ]
        self.client.upsert(collection_name=self.collection, points=points, wait=True)

    def remove_except(self, shop_id: str, keep_ids: set[str]) -> int:
        """Delete shop_id's points whose ids are not in keep_ids; returns the count."""
        shop_filter = qm.Filter(
            must=[qm.FieldCondition(key="shop_id", match=qm.MatchValue(value=shop_id))]
        )
        if keep_ids:
            shop_filter.must_not = [qm.HasIdCondition(has_id=list(keep_ids))]
        removed = self.client.count(
            collection_name=self.collection, count_filter=shop_filter, exact=True
        ).count
        if removed:
            self.client.delete(
                collection_name=self.collection,
                points_selector=qm.FilterSelector(filter=shop_filter),
                wait=True,
            )
        return removed

    def search(self, shop_id: str, vector: list[float], limit: int) -> list[Hit]:
        """Nearest neighbours of vector, filtered to the caller's shop only."""
        result = self.client.query_points(
            collection_name=self.collection,
            query=vector,
            query_filter=qm.Filter(
                must=[qm.FieldCondition(key="shop_id", match=qm.MatchValue(value=shop_id))]
            ),
            limit=limit,
            with_payload=True,
        )
        return [
            Hit(product_id=point.payload["product_id"], score=point.score)
            for point in result.points
        ]
