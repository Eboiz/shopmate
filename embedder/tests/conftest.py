"""Shared test fixtures. No test ever loads the real embedding model."""

import hashlib
import math

import pytest
from PIL import Image

from shopmate_embedder.formatting import ProductDoc, document_input, query_input

# 4x4 red image used by the formatting tests, named as in the plan snippets.
RED_PNG = Image.new("RGB", (4, 4), "red")


class FakeEmbedder:
    """Implements the Embedder protocol with a deterministic dim-4 vector.

    The vector is a normalised SHA-256 hash of the formatted document/query
    input (text plus, when present, the image's pixel size), so the same input
    always yields the same vector and different inputs rarely collide.
    """

    dim = 4

    @staticmethod
    def _key(inp: str | dict) -> str:
        text = inp if isinstance(inp, str) else inp["text"]
        sizes = ""
        if isinstance(inp, dict):
            sizes = "|".join(f"{img.width}x{img.height}" for img in inp["image"])
        return f"{text}|{sizes}"

    def _vector(self, key: str) -> list[float]:
        digest = hashlib.sha256(key.encode("utf-8")).digest()
        values = [byte / 255.0 for byte in digest[: self.dim]]
        norm = math.sqrt(sum(v * v for v in values)) or 1.0
        return [v / norm for v in values]

    def embed_documents(self, docs: list[ProductDoc]) -> list[list[float]]:
        return [self._vector(self._key(document_input(doc))) for doc in docs]

    def embed_query(self, image: Image.Image, text: str | None) -> list[float]:
        return self._vector(self._key(query_input(image, text)))


@pytest.fixture
def fake_embedder() -> FakeEmbedder:
    return FakeEmbedder()
