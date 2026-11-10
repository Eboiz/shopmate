"""Frozen settings read from environment variables."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """All embedder configuration; None means the consumer does not need it."""

    qdrant_url: str | None
    qdrant_api_key: str | None
    qdrant_collection: str
    embed_dim: int = 768
    embedder_token: str | None = None
    supabase_url: str | None = None
    supabase_secret_key: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            qdrant_url=os.environ.get("QDRANT_URL"),
            qdrant_api_key=os.environ.get("QDRANT_API_KEY"),
            # prod uses shopmate_products; everything else shopmate_products_dev.
            qdrant_collection=os.environ.get("QDRANT_COLLECTION") or "shopmate_products_dev",
            embedder_token=os.environ.get("EMBEDDER_TOKEN"),
            supabase_url=os.environ.get("SUPABASE_URL"),
            supabase_secret_key=os.environ.get("SUPABASE_SECRET_KEY"),
        )
