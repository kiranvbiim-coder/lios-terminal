# LiOS active open-source decisions — 2026-10-27

**Applies to unified PR #318, not production main.** The source registers remain the immutable-ish historical record. This is the **only active donor worklist** for deciding new code work. An entry in `third_party/components.json`, the 92-donor register, an observed GitHub fork or a bookmarked design website is **not** a task.

## Decision

**Take a donor when it closes a measured gap in a current LiOS user journey. Otherwise keep it out of the build and out of the active queue.** This is not a target to install all 92 upstream applications or harvest all ten forks. Do not remove legitimate source or licensing attribution for already-shipped/adapted code.

### Active — finish what LiOS already uses

| Donor identity | Existing LiOS owner | Specific work, no duplicate owner |
| --- | --- | --- |
| openclaw | GM execution / governed AI / browser & device | Verify selected native execution, cancellation, egress and bounded BYOAI paths |
| qlib | P11 finance / canonical numerical engines | Validate existing formula challenger on exact-source inputs and packaged sidecar |
| tradingagents | GM-12 / P7 research | Qualify source-backed multi-view risk/research handoff, without donor trading runtime |
| univer | P4 Artifact | Exercise saved spreadsheet editing, permission and file-return roundtrip |
| echarts | P4 Chart Artifact | Qualify the optional renderer in production build/installed desktop |
| docling | Existing sandbox document ingestion | Qualify actual local image/binary and document-rights evidence |

### Active — finish only selected source adaptations

| Donor identity | Existing LiOS owner | Specific work |
| --- | --- | --- |
| langalpha | P7 & GM models | Selected provenance and bounded response parsers, not full LangAlpha |
| FinRobot | P4/P11 Artifact reports | Existing immutable report/source validation and semantic change reviews |
| graphrag | P7 source evidence / P5 entity | Existing permitted source links, never a second graph DB |
| browser-use | GM-14 governed browser | Existing download/egress containment, no ambient browser agent |

## Archived as a **work item** (not deleted as evidence)

- **43 historically documented-only and 15 reference-only baseline entries** are no longer an automatic 'work through them all' backlog. The one currently selected baseline LangAlpha slice is explicitly kept active; all other candidates need new user-journey approval. Already-integrated stable libraries can remain installed without recurring donor-development tickets.
- Existing alternative runtime and overlapping tool candidates — **FlexLayout** versus Dockview; **LangGraph JS / Pydantic AI / Dexter / Fin-Agent** versus canonical LiOS agent+tools; **OpenTerminal/UI / HQTUI** versus current LiOS terminal; unsupported trading/backtesting services and market-data providers — receive **no active import ticket**.
- **FinGPT** and **CUA** fork mirrors have no approved model/driver-rights or release pathway for expansion now. Mirror observation is not source import.
- Design-inspiration domains (e.g., Mobbin, Godly, Modulify, 60fps.design) are research links, not dependencies or code-import goals. **beUI, Watermelon UI and OpensourceUI** have selected source adaptations already preserved in the product.
- Conditional challengers have explicit reconsideration triggers only: **Monaco** if the existing code editor fails a documented editable-code use case; **TanStack Virtual** if existing lists breach measured 390px/200%-zoom/performance requirements; **Arelle** if real SEC filings cannot be processed by the present parser; **MapLibre/deck.gl** only if an actual rights-cleared map use case justifies the footprint; **llama.cpp/whisper.cpp** only for an approved offline model/voice deployment with verified native/model rights. These are *not active tasks*.
- Do **not** delete code in use, source grants, `THIRD_PARTY_NOTICES.md`, `third_party/licenses`, version locks or prior review evidence to make the donor count lower. An unbundled candidate adds no runtime size; it can be removed from the **active scope** without destructive source-history edits.

## Promotion rule for an archived candidate

A new candidate cannot be added to `executionPriorities` until (1) a named current user journey and failing incumbent benchmark, (2) exact rights-checked upstream source pin and package/dependencies, (3) a single canonical LiOS consumer without a competing runtime/store/provider, (4) an actual test and native release gate, and (5) an explicit recorded decision establish why this donor—not a new feature request or an existing component—is necessary. Reconcile source-truth and selected-adoption evidence before changing the queue; never grant import rights by changing a JSON label.

## Cleanup effect

`third_party/universal-donor-adoption.json` now has **two finite workstreams with 10 selected donor identities** instead of four open-ended waves, including the removed catch-all `all_other_registered_donors`. The **92 baseline / 10 fork** register is preserved for honest legal/source history, not counted as active implementation work. The source validator rejects unknown, reference-only, rejected or unapproved documented candidates, catch-all scope, duplicates and absent user journeys.

**Release priority remains above new donor importing:** the exact-head CI, packaged reverse-DCF 502, installed Electron qualification and approved media rights must pass before releasing or merging to `main`.
