"""Document/query inputs for google/embeddinggemma-2 (PB-30)."""

from dataclasses import dataclass

from PIL import Image

DOC_FORMAT_VERSION = "v1"

# Token marking where the image goes, per the PB-30 format.
IMAGE_TOKEN = "<|image|>"
# "task: search result" is the model's query-task instruction; documents carry
# no task prefix.
QUERY_TASK_PREFIX = "task: search result | query: "


@dataclass
class ProductDoc:
    """One catalog product to embed; `image` may be None (text-only document)."""

    product_id: str
    shop_id: str
    code: str
    name: str
    category: str | None
    description: str | None
    colors: list[str]
    image: Image.Image | None


def document_input(doc: ProductDoc) -> str | dict:
    """Interleave text and image for a product document; str when there is no image."""
    parts: list[str] = []
    if doc.category:
        parts.append(doc.category)
    if doc.description:
        parts.append(doc.description)
    if doc.colors:
        parts.append("Màu: " + ", ".join(doc.colors))
    body = ". ".join(parts) if parts else doc.name
    text = f"title: {doc.name} | text: {body}"
    if doc.image is None:
        return text
    # The token marks where the image goes; only documents with an image get it.
    return {"text": f"{text} {IMAGE_TOKEN}", "image": [doc.image]}


def query_input(image: Image.Image, text: str | None) -> dict:
    """Query input with the search-task prefix; an image alone gets no prefix."""
    body = f"{QUERY_TASK_PREFIX}{text} {IMAGE_TOKEN}" if text else IMAGE_TOKEN
    return {"text": body, "image": [image]}
