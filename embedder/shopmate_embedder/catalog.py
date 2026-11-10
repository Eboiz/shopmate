"""Catalog access: PostgREST reads and catalog photo loading."""

import logging
from dataclasses import dataclass, field
from io import BytesIO

import httpx
from PIL import Image

from shopmate_embedder.formatting import ProductDoc

logger = logging.getLogger(__name__)


@dataclass
class CatalogReader:
    """Reads shop rows from Supabase PostgREST with the service-role key."""

    http: httpx.Client
    supabase_url: str
    secret_key: str
    # image_url per product id from the last products() call; ProductDoc has
    # no URL field, so index_shop loads the photos from here.
    image_urls: dict[str, str | None] = field(default_factory=dict)

    def _headers(self) -> dict[str, str]:
        return {"apikey": self.secret_key, "Authorization": f"Bearer {self.secret_key}"}

    def shop_id(self, slug: str) -> str:
        response = self.http.get(
            f"{self.supabase_url}/rest/v1/shops",
            params={"slug": f"eq.{slug}", "select": "id"},
            headers=self._headers(),
        )
        response.raise_for_status()
        rows = response.json()
        if not rows:
            raise LookupError(f"unknown shop slug: {slug}")
        return rows[0]["id"]

    def products(self, shop_id: str) -> list[ProductDoc]:
        response = self.http.get(
            f"{self.supabase_url}/rest/v1/products",
            params={
                "select": "id,code,name,category,description,image_url,variants(color)",
                "shop_id": f"eq.{shop_id}",
            },
            headers=self._headers(),
        )
        response.raise_for_status()
        self.image_urls.clear()
        docs = []
        for row in response.json():
            self.image_urls[row["id"]] = row.get("image_url")
            colors: list[str] = []
            for variant in row.get("variants") or []:
                color = variant.get("color")
                if color and color not in colors:
                    colors.append(color)
            docs.append(
                ProductDoc(
                    product_id=row["id"],
                    shop_id=shop_id,
                    code=row["code"],
                    name=row["name"],
                    category=row.get("category"),
                    description=row.get("description"),
                    colors=colors,
                    image=None,
                )
            )
        return docs


def load_image(http: httpx.Client, url: str | None) -> Image.Image | None:
    """Fetch and decode a catalog photo; None when missing or unreadable."""
    if not url:
        return None
    try:
        response = http.get(url)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content))
        image.load()  # force decoding so truncated/corrupt bytes fail here
        return image
    except (httpx.HTTPError, OSError, Image.DecompressionBombError) as exc:
        logger.warning("could not load image %s: %s", url, exc)
        return None
