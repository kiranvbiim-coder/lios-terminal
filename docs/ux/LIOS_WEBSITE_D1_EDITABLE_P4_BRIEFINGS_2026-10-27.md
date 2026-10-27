# LiOS Website D1 — Source-bound editable P4 briefing visuals
**27 October 2026** · website tracker #258 · base C3 PR #294.

## Actual integrated user journey

Inside existing Project Briefing Studio, choose recorded P7 insights and up to three active Project-owned P4 charts/tables. Selecting a visual explicitly performs one authenticated same-origin P4 GET. Only a valid current head-version chart/table with recorded sourceRefs, bounded native content and a matching Project ID is accepted. The Studio previews the chosen title, saved version, SHA-256 and original source-reference count.

The canonical `composeProjectBriefing` produces **one editable report**. A pinned P4 chart becomes `chart_ref.attrs.chart`; a pinned table becomes `table.attrs.table`, each with exact origin Artifact ID, version, content hash and recorded source identifiers. Report blocks/sections stay valid P4 content. Source refs are written to canonical P4 `sourceRefs`, while source refs plus exact `artifact:` / `artifact-version:` identities are in `dependencyRefs`. Native P4 PowerPoint export already creates actual native chart and table objects from the exact embedded payload; DOCX/export uses the same report source. No second deck store, renderer, slide schema, paid asset, media license or calculation backend has been added.

Before the single Save write, every pinned P4 exact version is authenticated GET again with `cache: no-store`, checked against head version, sourceRefs, content hash and exact payload. A revoked, archived, changed or denied saved visual stops the write. The final P4 response must match Project, type, origin, head-version, reported content and original source/dependency metadata or the UI warns of an **ambiguous save** rather than claiming success/retrying blindly. Report-only briefings remain available when no visual is chosen.

## Limits and honest scope

Up to 16 insights and 3 exact visual snapshots; chart <=8 series / <=1200 recorded points, table <=8 columns / <=40 recorded rows; no silent aggregation, new units, generated values, or partial source table. More than 200 combined refs stops composition, never drops silently. P4 IDs and hashes prove recorded version identity, not fresh external provider redistribution rights or independent claim verification. This is **native editable source-backed visual inclusion**, not a finished cinematic slide theme/film generator and not an AI-powered editable PowerPoint designer.

## Gates

`cd src && npm run test:website-d1 && npm run check && npm run test:offline && npm run build`.

Focused tests cover cross-Project/missing sources/stale head/hash/payload, chart/table bounds, exact native report block shapes, provenance, versioned P4 save receipt and absence of second stores or unauthorized background work. Source CI runs `test:website-d1` on existing public Linux runner.

Keep PR stacked and draft until exact-head CI and installed Mac/Windows Electron visual/keyboard/screen-reader/offline/revocation/390px/200%-zoom/export+reimport verification pass. Not a production or launch signoff. D2 is the native installed UX / release-readiness convergence.
