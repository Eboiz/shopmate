PO source for PB-28

- Workbook version dated 02/11/2026, supplied as ShopMate - Demo data and test set.xlsx.
- SHA-256 of the supplied workbook is 80e96e7f435a6c2e5759b877d9c6dd30dfc02b23947ee045709810c0fce4e508.
- Source issue is https://github.com/Eboiz/Documents/issues/29.
- Exported on 07/11/2026. The six catalog CSVs and test_questions.csv preserve the workbook's headers, values and product codes. Blank cells remain blank. The original product image column is blank; JPEG assets and their credits are maintained separately in images/.
- Current approved source has 30 products, 242 variants, 105 size-chart rows, 10 pairings, 3 policies and 60 question fixtures.
- PB-28's final target is 60 products and 20 pairings. The PO supplies and approves the additional rows. SP31-SP60 already present in the shared database are retained for comparison at the user's request and are reported as extra rows by the seed. They are outside this source export.
- 11/11/2026, PB-28 stage 2: to reach 60 products and 20 pairings, 30 products (with their variants, size charts, descriptions and photos) and 10 pairings were taken from the Mây Boutique catalog and given Hạnh Boutique codes: SP08→AO10, SP10→AO11, SP12→AO12, SP21→QUAN06, SP22→QUAN07, SP32→VAY09, SP33→VAY10, SP34→VAY11, SP35→VAY12, SP36→VAY13, SP37→AO13, SP38→AO14, SP39→AO15, SP40→AO16, SP41→AO17, SP42→AO18, SP43→AO19, SP44→AO20, SP45→AO21, SP46→AO22, SP47→AO23, SP48→QUAN08, SP49→QUAN09, SP50→QUAN10, SP51→QUAN11, SP52→QUAN12, SP53→QUAN13, SP57→CV06, SP58→AK04, SP60→AK05. Categories use this export's values (vay, ao, quan, chan_vay, ao_khoac) and colors are lower case. Left out: products whose name is the same as, or close to, a PO product (SP01, SP02, SP04-SP07, SP09, SP13-SP17, SP19, SP20, SP23-SP28, SP31, SP54, SP55), SP56 (a second "chân váy xếp ly" would break question 21) and SP59 (questions 25-26 need "áo măng tô" to be missing); SP03, SP11, SP18, SP29 and SP30 were not needed. These rows await the PO's review. Migration 20261111150000_pb28_catalog_60.sql removes the legacy SP31-SP60 rows from the Hạnh Boutique shops, so they are no longer extra rows.
- The catalog merged in PR #41 (SP01-SP60) is kept as a separate shop, Mây Boutique, in ../may-boutique/ with its own photos. Some of its names overlap protected test searches (SP59 "Áo măng tô qua gối"), so rows taken from it into this export need PO review.

- 11/11/2026, PB-31 (Eboiz/Documents#32): the products.csv `mo_ta` column (2–4 sentences on material, fit, length, stretch, care and occasion) and two policy texts (`khuyen_mai`, and the delivery-days sentence in `giao_hang`) were drafted for PB-31 and differ from the workbook. They await the PO's row-by-row review. All other values, including the existing policy facts and numbers, are unchanged. The same drafts were applied to ../may-boutique/.

To refresh the source, export the named sheets to UTF-8 CSV with the same headers and run pnpm db:seed --check. This checks question labels against the catalog using the production size and pairing logic. PB-10 evaluates the AI engine's replies.

Images are illustrative CC0 stock photos. See images/CREDITS.md for sources and reuse details.
