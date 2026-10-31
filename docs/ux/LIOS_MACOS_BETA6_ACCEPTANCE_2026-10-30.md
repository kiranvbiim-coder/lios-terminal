# macOS beta.6 acceptance — 2026-10-30

Build: `1.0.0-beta.6`, protected source `6a970cdfd00773f3838978c0ec89d7dfe5763172`, macOS arm64. Actual packaged app; isolated Home `/tmp/lios-beta6-ui-home`, separate Electron profile. Owner installation unchanged. This is a working acceptance record, not release approval or full-product completion.

## Observed passes

- Packaged selftest: OS-protected secret roundtrip, workspace reopen, bundled Python3.13.5 statistics mean3 and reverse-DCF repriced equity100; no Python bytecode writes into sealed resources. Report `/tmp/lios-beta6-native-selftest.json`.
- Real first-owner UI → trial/key choice → explicit seven-day trial; Project creation and cold restart retained Project and original trial expiry.
- Owner signer `170917030f55c8da`: verification-only key activated through packaged Connections license UI; `license_valid`. Private key never printed or bundled.
- Isolated expired trial (fixture-only trial-end change, verification license withheld): analysis refused402 `license_read_only`, Project read200 and Project artifact-package export200. This package export contained no authored report; full document-content export acceptance remains separate.
- Offline Doctor Chat persisted a deterministic response without an AI provider.
- Packaged personal-finance calculation: assets200000, liabilities50000, net worth150000.
- Explicit reviewed Core install copied/activated hash-locked native bundle; managed readiness became ready. This is not strict-image execution qualification.
- Opt-in local FinanceDatabase import completed:301886 reference listings, pinned source `3815eb341c7aa7bfae4a720744093e75528b6099`; equities121518, ETFs31968, funds56564, indices82360, cryptos5735, currencies2516, money markets1225. Reference identities are provisional, not live-price or tradability coverage. No catalog included in public source/distribution.
- Directory Microsoft lookup returned41 matches; Workbench autocomplete rendered exchange-specific MSFT results. Keyboard selection opened MSFT Overview.
- Ticker-scoped News opened from MSFT Overview. Actual feed returned154 stories,20 on page1, rendered upgraded card/read-through layout and source/freshness labels. RSS-summary fallback explicitly disclosed publisher-text retrieval failure. Story Evolution displayed0 observed changes rather than fabricated history. Public feed retrieval used no configured paid account or AI provider.

## Failures and unresolved observations

- News autocomplete results rendered but pointer selection was blocked by another element (`div.flex.min-w-0`); keyboard selection succeeded. Requires overlay/stacking diagnosis; no fix yet.
- News displayed `VERIFIED PHOTOS 0`; no loaded image elements. Read-through showed five repeated empty Context imagery / Find context image slots. Image-led design and attribution/rights journeys are NOT passed.
- Strict runtime inventory reports Python3.12.10 and missing statsmodels/fastapi/uvicorn, independently of activated native bundle and bundled frozen sidecar. Normal strict calculations use the immutable Linux image; native activation does not change it. Misleading runtime labeling/readiness reconciliation and affected strict engine coverage remain open. No host fallback authorized.
- Initial Workbench expansion appeared to revert; instrumented follow-through recorded only `workbench` and remained open without renderer errors. Root cause not established; do not claim repaired or alter navigation speculatively.

## Remaining acceptance

- News search/date/source/sentiment/paging, context-image permission/attribution/failure, Pulse grouping/follow/mute, Watchrooms, visual search, perspectives, map/graph and timelines.
- Instrument ambiguity/unknowns/crypto/exchange facets, cold-reopen catalog persistence, canonical identity and no invented price coverage.
- Exact Artifact revision Chat→sidecar→same Workbench→edit/save→return/restart; reports/spreadsheets/charts and actual export contents.
- Automation/notifications, local voice/cancellation, keyboard/zoom/accessibility; unavailable microphone/runtime remains explicit.
- Real backup/restore, beta.5→beta.6 verified manual upgrade, fresh-start owner replacement.
- Live AI/data/Telegram accounts deferred by owner until offline pass, then credentials entered directly in app. No paid/provider actions implicitly approved.
- F01–F12 rich intelligence contract and65-workstream UX matrix remain cross-checks; neither is closed by these bounded passes.

## Defect diagnosed after the first pass

- **News duplicated "Context imagery" slots (root cause found, source fix not yet shipped):** the packaged DOM grew by about four stale `news-image-discovery` sections per minute (1→4→13→21; selecting any story reset it to1). React fibers showed one live component and many orphaned mounts. Cause: `NewsPanel` gave `NewsImageDiscovery` and `NewsMediaPreview` the same sibling key (`selectedItem.url`). When the conditional automatic-context note flipped, React fell to keyed-map reconciliation, matched the wrong same-key sibling, and never deleted the old section. A standalone production-React/Chromium harness reproduced it (original keys:4 sections after six flips; distinct keys:1). Fix on branch `fix/news-keyed-sibling-leak`: keys are `context-image:<url>` and `media-preview:<url>`; typecheck passed. The harness was deleted; there is no permanent DOM regression test because the repo has no DOM test renderer. The installed beta.6 build still contains the defect until rebuilt, so News imagery acceptance stays **failed** for that build. Pointer-selection blocking and empty verified-photo inventory remain separate unresolved items.
