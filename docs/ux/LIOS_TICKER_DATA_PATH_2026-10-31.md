# Ticker data path, first-run market data and global securities (2026-10-31)

Evidence from a packaged macOS arm64 `--dir` build (1.0.0-beta.10, ad-hoc signed, **not installer acceptance**), fresh isolated
profiles with the local Ollama model. Windows, VoiceOver and live paid providers were not exercised.

## One market-data policy
- **Defect:** Chat runs reach the server over the WebSocket Gateway, which binds no request identity. Unscoped work is treated as
  authorized for every provider, so Chat used Yahoo for an account that had selected no source and given no consent, while the
  Workbench HTTP routes (which do bind identity) correctly returned nothing.
- **Fix:** `server/ownerRequestIdentity.ts` binds the owner's persisted selection and consents around Gateway runs and Chat tool
  calls; `shared/marketDataAccess.ts` holds the single rule used by the server, the planner and the first-run step.
- **Observed:** account with Yahoo selected and consented: Chat and `/api/finance/ohlcv` both return real bars (TSLA 186, AMZN 251).
  Account that chose "I'll add provider keys later": Chat answers "No market-data source is selected for your account. Choose a
  market-data source in Connections" and the route returns `bars: []` with `reason: "no_source_selected"`; neither uses Yahoo.
- Empty or blocked market answers are no longer pinned in the browser cache (30 minutes before), so choosing a source takes effect at once.

## First run
Order: license choice, Connect your AI, **Choose your market data** (explicit, unchecked consent box; "I'll add provider keys
later" is remembered per account), workspace.

## Chat → Workbench
- Two panes (Chat sidecar and Workbench) mounted the same terminal screen and autosaved the same default state at the same moment;
  the loser received `409 Artifact head moved` and blocked Return to Chat. Saves are now serialized per Artifact and a sibling's
  identical save is not repeated. Observed: one save, no 409, "Saved analytical state · v2", Return to same Chat restores the conversation.

## Global securities (300k+)
- Real in-app install: 84 MB download, 186 files, 168.6 MB extracted, **301,886** rows imported in about 20 s, pinned upstream
  `3815eb341c7aa7bfae4a720744093e75528b6099`.
- Search ranks the primary listing first (RELIANCE.NS before RELIANCE.BO, MSFT@NMS, INFY.NS, 7203.T, SAP.DE, NESN.SW, AAPL@NMS),
  about 70 ms per query after a 0.5 s first-query index build.
- The catalog survived an app restart. Catalog-only symbols are labelled reference only and never given a price.

## Other fixes in this batch
- A professional report request ("Create a risk report") keeps the governed P5 workflow; "a short memo", "a 1-page summary", "a brief" become AI documents.
- The packaged server no longer depends on its working directory to find `js-yaml` (launching from another folder previously left the app without a window).

## Known, not changed
- The AI authorization proof is per server start, so after a restart Chat shows a one-click "Reconnect <provider>" (security design, not a defect).
- After that reconnect a first run showed a "1 failed" reconciliation notice on the answer step; not reproduced or diagnosed.
- Live provider keys, the retail community-consent profile, Windows and a signed/notarized installer remain unverified.
