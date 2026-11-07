PO source for PB-28

- Workbook version dated 02/11/2026, supplied as ShopMate - Demo data and test set.xlsx.
- SHA-256 of the supplied workbook is 80e96e7f435a6c2e5759b877d9c6dd30dfc02b23947ee045709810c0fce4e508.
- Source issue is https://github.com/Eboiz/Documents/issues/29.
- Exported on 07/11/2026. The six catalog CSVs and test_questions.csv preserve the workbook's headers, values and product codes. Blank cells remain blank. The original product image column is blank; JPEG assets and their credits are maintained separately in images/.
- Current approved source has 30 products, 242 variants, 105 size-chart rows, 10 pairings, 3 policies and 60 question fixtures.
- PB-28's final target is 60 products and 20 pairings. The PO supplies and approves the additional rows. SP31-SP60 already present in the shared database are retained for comparison at the user's request and are reported as extra rows by the seed. They are outside this source export.
- The catalog merged in PR #41 (SP01-SP60) is kept as a separate shop, Mây Boutique, in ../may-boutique/ with its own photos. Some of its names overlap protected test searches (SP59 "Áo măng tô qua gối"), so rows taken from it into this export need PO review.

To refresh the source, export the named sheets to UTF-8 CSV with the same headers and run pnpm db:seed --check. This checks question labels against the catalog using the production size and pairing logic. PB-10 evaluates the AI engine's replies.

Images are illustrative CC0 stock photos. See images/CREDITS.md for sources and reuse details.
