# Document/query input formatting, exactly as specified in the PB-30 plan.
from conftest import RED_PNG

from shopmate_embedder.formatting import (
    ProductDoc,
    document_input,
    query_input,
)


def test_document_with_image_is_interleaved():
    doc = ProductDoc("p1", "s1", "AO01", "Áo sơ mi lụa", "áo", "Cổ đức, tay dài", ["trắng", "be"], image=RED_PNG)
    out = document_input(doc)
    assert out["text"] == "title: Áo sơ mi lụa | text: áo. Cổ đức, tay dài. Màu: trắng, be <|image|>"
    assert out["image"] == [RED_PNG]

def test_document_without_image_or_optional_fields_is_text_only():
    doc = ProductDoc("p1", "s1", "Q1", "Quần ống rộng", None, None, [], image=None)
    assert document_input(doc) == "title: Quần ống rộng | text: Quần ống rộng"


def test_query_with_text_prefixes_task_and_image_alone_has_no_prefix():
    assert query_input(RED_PNG, "váy hoa đỏ") == {"text": "task: search result | query: váy hoa đỏ <|image|>", "image": [RED_PNG]}
    assert query_input(RED_PNG, None) == {"text": "<|image|>", "image": [RED_PNG]}
