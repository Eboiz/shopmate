"""EmbeddingGemma embedder.

Heavy dependencies (torch, sentence_transformers) are imported lazily inside
GemmaEmbedder so importing this module (and every test) never loads the model.
"""

from typing import Protocol

from PIL import Image

from shopmate_embedder.formatting import ProductDoc, document_input, query_input

MODEL_ID = "google/embeddinggemma-2"
BATCH_SIZE = 8


class Embedder(Protocol):
    dim: int

    def embed_documents(self, docs: list[ProductDoc]) -> list[list[float]]: ...

    def embed_query(self, image: Image.Image, text: str | None) -> list[float]: ...


class GemmaEmbedder:
    """Loads MODEL_ID once; documents and queries are formatted by shopmate_embedder.formatting."""

    def __init__(self, dim: int = 768, *, model_id: str = MODEL_ID):
        import torch
        from sentence_transformers import SentenceTransformer

        self.dim = dim
        # bfloat16 only where CUDA supports it, float32 otherwise; never float16.
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
        self._model = SentenceTransformer(
            model_id,
            config_kwargs={"audio_config": None},
            model_kwargs={"dtype": dtype},
        )

    def embed_documents(self, docs: list[ProductDoc]) -> list[list[float]]:
        inputs = [document_input(doc) for doc in docs]
        return self._model.encode(
            inputs, normalize_embeddings=True, truncate_dim=self.dim, batch_size=BATCH_SIZE
        ).tolist()

    def embed_query(self, image: Image.Image, text: str | None) -> list[float]:
        input_ = query_input(image, text)
        return self._model.encode(
            [input_], normalize_embeddings=True, truncate_dim=self.dim, batch_size=1
        )[0].tolist()
