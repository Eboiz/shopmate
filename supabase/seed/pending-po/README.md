Candidate products from PR #41

These CSVs preserve the SP31-SP60 additions merged in https://github.com/Eboiz/shopmate/pull/41, from main commit 20f5a3d, for PO comparison alongside the original workbook.

The snapshot contains 30 products, 343 variants, 126 size-chart rows and 20 pairings. Its CC0 photos and credits remain in ../demo/images/ under the SP31.jpg-SP60.jpg filenames.

PO review should align these rows with PB-28 and the 60 question fixtures before incorporating them into ../demo/. In particular, SP59 is named “Áo măng tô qua gối”, which overlaps the test set's missing-product case. Some candidate pairings refer to legacy SP01-SP30 codes and require explicit mapping to the PO catalog.

The active CSV export is the PO workbook's original 30-product catalog. The shared database's existing SP31-SP60 rows are retained for comparison and reported by the seed as extra rows.
