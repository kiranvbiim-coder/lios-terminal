# LIOS D2 — Real native Office return and installed-product release boundary
**Date:** 2026-10-27
**Branch:** cumulative D2 after LIOS Project Briefing Studio D1 #300
**Donor/source review:** website D2 #299 at a4c982d7a7c9aa235e39f0841e319265379bada7

## Product flow

Keep the existing, user-ordered eight-source Project Library briefing. User explicitly pins up to three *already saved, source-bound, Project-owned* P4 chart/table versions. A fresh same-origin P4 read and exact result/permission/source/hash comparison occurs before the sole final Save. The native Office exporter uses exactly the saved report blocks for editability; no new slide store, network media, paid renderer or AI-generated data is created.

## Automated gate added

- Canonical source report -> actual native editable PowerPoint **chart, table, and local embedded workbook** -> secure `readOfficeArtifactRoundtrip` -> exact original report content, source identity, version and receipt.
- Repeat the same export with the same inputs to assert byte-for-byte deterministic Office output.
- Same report -> DOCX native table and P4 custom source metadata.
- Saved visual comparisons use `stableSerialize` so semantically identical records are not rejected solely because JSON object insertion order differs; changed observed values/source references remain blocked.
- Enforce source reference bounds *before* emitting frames so an oversized source cannot be silently truncated as supposed complete provenance.
- The new `test:website-d2` is included in Linux, Windows and macOS source CI, in addition to D1/B3/C1/C2/C3 and full `test:offline` checks.

## Real installed acceptance, explicitly open

The separate integrated Phase 4 native beta/evidence gate #296 and website D2 #299 have broader release-manifest and installed-device dependencies **not present** in this cumulative application ancestry; their checkers must not be overlaid as a second incompatible release system. Reconcile with the release owner before any launch.

On **installed Windows x64 and macOS ARM64** packages, reviewers must capture real screenshots/logs and test:
1. User owned source can be added, reordered, removed, exact version inspected, and saved as one P4 report; revoked or cross-Project sources never save.
2. Native PowerPoint opens with editable line chart and table (not screenshots) and numeric chart workbook; roundtrip keeps original source/versions.
3. DOCX editable table, Report reopening, saved provenance and failure states.
4. Narrow 390px, 200% zoom, keyboard focus, screen reader, reduced motion and offline/reconnect.
5. Previously integrated A–C follow/mute, graph, offline geography, visual Chat answers, reviewed model receipts and evidence review remain accessible and Project scoped.

No file of synthetic screenshots/flags and no hosted source CI result counts as installed acceptance. **Draft until exact-head CI plus real installed verification.**
