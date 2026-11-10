"""Online flow HTTP API: POST /search and GET /health (PB-30 Task 3).

Consumes Task 1 (Embedder, ProductVectors). Local dev runs the same app:
uv run uvicorn --factory shopmate_embedder.api:app_from_env --port 8008
"""

import base64
import binascii
import hmac
import threading
from io import BytesIO
from typing import Literal
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field
from qdrant_client import QdrantClient
from starlette.concurrency import run_in_threadpool

from shopmate_embedder.config import Settings
from shopmate_embedder.model import MODEL_ID, Embedder, GemmaEmbedder
from shopmate_embedder.vectors import ProductVectors

MAX_IMAGE_BYTES = 5 * 1024 * 1024


class SearchBody(BaseModel):
    """POST /search body; JSON keys are camelCase per the plan interface."""

    shop_id: UUID = Field(alias="shopId")
    image_base64: str = Field(alias="imageBase64")
    media_type: Literal["image/jpeg", "image/png", "image/webp"] = Field(alias="mediaType")
    text: str | None = Field(default=None, max_length=200)
    limit: int = Field(default=5, ge=1, le=10)
    model_config = ConfigDict(populate_by_name=True)


class HitOut(BaseModel):
    product_id: str = Field(alias="productId")
    score: float


class SearchResponse(BaseModel):
    # FastAPI serializes response models with by_alias=True (camelCase on the wire).
    hits: list[HitOut]
    model: str
    dim: int


def _bad_image() -> JSONResponse:
    """The exact 400 body from the plan, without HTTPException's detail wrapper."""
    return JSONResponse(status_code=400, content={"error": "bad_image"})


def decode_query_image(image_base64: str) -> Image.Image | None:
    """Decode base64 with PIL; None for bad base64, bad image, or > MAX_IMAGE_BYTES."""
    try:
        raw = base64.b64decode(image_base64, validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(raw) > MAX_IMAGE_BYTES:
        return None
    try:
        image = Image.open(BytesIO(raw))
        image.load()  # force decoding so truncated/corrupt bytes fail here
    except (OSError, Image.DecompressionBombError):
        return None
    return image


def embed_query_locked(
    embedder: Embedder, image: Image.Image, text: str | None, lock: threading.Lock
) -> list[float]:
    """Embed in a worker thread; the lock keeps one model instance serialised."""
    with lock:
        return embedder.embed_query(image, text)


def create_app(embedder: Embedder, vectors: ProductVectors, token: str) -> FastAPI:
    """Build the API around an already-loaded embedder; loads no model itself."""
    lock = threading.Lock()

    async def require_token(
        authorization: str | None = Header(default=None),
    ) -> None:
        supplied = (
            authorization[len("Bearer ") :]
            if authorization and authorization.startswith("Bearer ")
            else None
        )
        # Constant-time comparison so wrong tokens leak no timing information.
        if not supplied or not hmac.compare_digest(
            supplied.encode("utf-8"), token.encode("utf-8")
        ):
            raise HTTPException(status_code=401)

    app = FastAPI()

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "model": MODEL_ID}

    @app.post("/search", dependencies=[Depends(require_token)])
    async def search(body: SearchBody) -> SearchResponse:
        image = decode_query_image(body.image_base64)
        if image is None:
            return _bad_image()
        query_vector = await run_in_threadpool(
            embed_query_locked, embedder, image.convert("RGB"), body.text, lock
        )
        hits = await run_in_threadpool(vectors.search, str(body.shop_id), query_vector, body.limit)
        return SearchResponse(
            hits=[HitOut(productId=hit.product_id, score=hit.score) for hit in hits],
            model=MODEL_ID,
            dim=embedder.dim,
        )

    return app


def app_from_env() -> FastAPI:
    """Real GemmaEmbedder + Qdrant from env vars, for local dev and Modal.

    Raises RuntimeError when a required variable is missing; never write
    secrets in code.
    """
    settings = Settings.from_env()
    if not settings.qdrant_url or not settings.embedder_token:
        raise RuntimeError(
            "app_from_env requires QDRANT_URL and EMBEDDER_TOKEN; see embedder/.env.example."
        )
    embedder = GemmaEmbedder()
    vectors = ProductVectors(
        QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key),
        settings.qdrant_collection,
        embedder.dim,
    )
    return create_app(embedder, vectors, settings.embedder_token)
