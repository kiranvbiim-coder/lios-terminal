# Website integration A2 — rights-safe editorial image presentation and offline build gate

**Date:** 27 October 2026  
**Tracker:** [#258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258) · follows A1 [#261](https://github.com/kiranvbiim-coder/lios-terminal/pull/261)  
**Branch:** `feat/website-gap-a2-licensed-editorial-media-20261027` (stacked on A1, ultimately on #253)  
**Cash spend:** $0 additional.

## What has actually been coded

1. `src/shared/editorialMedia.ts` is the **single, exact** Zod representation of reviewed editorial media: a locally bundled, SHA-256-named, first-party URL `/editorial-media/<64 hex sha256>.{webp,avif,png,jpg,jpeg}`, meaningful alt, optional caption, human attribution, owner, license name, separately retained evidence-reference ID, verified-by/date, exact article/source ID, commercial display AND offline redistributability and active/revoked state. No arbitrary URL/scheme, SVG, inline HTML, remote host, token query, empty source or unknown property. Expired/revoked/pending images are excluded from projection.
2. Existing `PulseCardDraft` and News `NewsItem` gain **optional** media metadata; legacy source-free/read-through cards continue to work. Internal Wave D author route uses existing author permissions, validates strict media shape and blocks unlinked/expired/non-approved grants before saving. **This is a reviewed metadata assertion; it is not itself independent proof of intellectual-property ownership.**
3. `LicensedEditorialImage.tsx` is a shared presentation-only adapter for existing **Watermelon/beUI-inspired** `LiosPulseStoryCard` and `NewsEditorialStoryCard`. It only references the same-origin hashed path when actual media rights/linked evidence qualify. Keyboard source read-through, Ask LiOS and retained A1 grouping remain in their canonical owners. Captions identify attribution and license; the original designed abstract/typographic story hero returns automatically when permission, asset or load is unavailable. No remote favicon, stock service, unsandboxed iframe or new dependency.
4. The sole consolidated ledger is `src/client/public/editorial-media/manifest.json` (initially `[]`). The old separate A2 ledger was removed when reconciling explicit image intake with build/runtime verification. No image is inferred from an article URL; only reviewed grants and matching local bytes enter this manifest.
5. `verifyEditorialMedia.ts` verifies every public editorial asset against an explicit ledger: exact bytes SHA-256, permitted basic raster signatures, source-eligibility, non-symlink regular files, maximum 6 MB per file, no unlisted files, no duplicate names and no expired/revoked or **even future-expiring rights for irrevocable offline installers**. Mac and Windows `app:beta` entrypoints, the ordinary build and existing public Linux source CI run it. This is an integrity/license-assertion gate, not a substitute for human legal review.
6. New tests cover malicious/remote asset paths, revoked rights, source-ID mismatch, attribution and permission, renderer fallback/positive state, SHA mismatch, unknown files, spoofed HTML, symlinks and offline expiry.

## How to add an actual image without violating distribution rights

- Obtain and retain the **original media asset**, a signed/credible written grant for **commercial display and indefinite offline redistribution of shipped copies**, source ID and attribution; no watermarked/personal-only/revocable subscription media.
- Confirm provenance, privacy and consent for persons/locations shown. Do **not** treat publisher article URL, OpenGraph thumbnail, uploaded screenshot or credit line as a redistribution license.
- Use the explicit `import_licensed_editorial_image.ts` intake for a rights-cleared local raster and reviewed grant. It writes hash-named bytes and the sole `src/client/public/editorial-media/manifest.json` ledger. Credential-bearing article URLs are refused before any public write. The source build and built-asset gate independently check the same grants, hashes and public URL policy.
- Emit an exact referenced media entry in the existing authorized Wave D card or owned News projection, where `sourceEvidenceId` is one of the actual retained source IDs (News maps it to the article's exact URL). User-visible paths remain owned by the same app, never a remote provider.
- Run `cd src && npm run media:verify && npm run media:verify:test && npm run check`. Packaging will independently re-run verification. Human approval and actual installed image loading/accessibility remain separate gates.

**Limitations:** The current rights assertion includes a reviewer and license evidence ID but no legal-document verification integration; human review is required. Static public files can remain on already-installed machines; rejecting time-limited packaging rights prevents pretending runtime revocation can claw back previously distributed bytes. Asset file headers and hashes establish integrity, **not authorship or the legal license itself**.

## Status and next item

- **A2 source code:** committed for review. **No actual approved photos bundled**; code is not CI/native accepted until tests run.
- **A3 next:** user-scoped Follow/Mute and personal discovery using existing authenticated Wave D / watchlist authority (not an anonymous global localStorage list), with persistent server state, then Watchroom/Ask continuity.
- **A4, B–D:** remain open in #258. No new navigation, mirror feed, payment or unnecessary donor source clone.
