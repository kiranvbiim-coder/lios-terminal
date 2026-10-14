# LiOS Foundation Donor Execution Map

**Status:** F0 execution evidence / donor-first implementation map  
**Effective:** 2026-10-07  
**Task:** #449  
**Base main:** `a086349fb2a6b1874648987e6cae46e503f60d39`  
**Machine companion:** `third_party/foundation-donor-map.json`  
**Parent authority:** `docs/technical/LIOS_FOUNDATION_LOCK_DONOR_EXECUTION_AMENDMENT.md`

## 1. Purpose

This document answers one execution question:

> **Which donor mechanisms should LiOS inspect/reuse first to close SP-01, SP-02, SP-03 and SP-04 without creating duplicate architecture?**

It is not another master plan and does not replace the 92-entry capability-assimilation registry. The historical 92 baseline remains the complete donor analysis/accounting source. This file is the Foundation execution overlay that turns that catalog into an immediate donor-first queue.

The rule remains:

> **inspect current LiOS → search controlled mirrors → search the 92 baseline → search additional donors → decompose/reuse/adapt/combine → build new last.**

Layer A/Layer B classifications are maintenance labels only. Any suitable documented donor may be used or forked. Suitable new donors may be discovered, forked and assimilated inside an authorized workstream without another owner approval, with mandatory license/provenance/registry recording.

---

## 2. F0 conclusions

### 2.1 Do not bulk-install donors

Aggressive donor use means **maximum useful leverage**, not maximum package count.

If LiOS already has a stronger working path, the donor should be a challenger, validator or triggered fallback rather than an unnecessary second runtime.

Examples:

- current LiOS DOCX/PDF exporters exist and have deterministic evidence-preserving tests, so `python-docx`, `python-pptx`, XlsxWriter and React-PDF are not automatically installed merely because they are documented;
- Dockview already owns the working workspace renderer, so FlexLayout/OpenTerminal-style projects cannot introduce another workspace authority;
- P7/P5 already own research retrieval/entity truth, so GraphRAG may strengthen mechanisms but may not establish a second knowledge/entity store;
- P11 remains deterministic Finance authority even when Qlib/FinRobot/TradingAgents/FinGPT supply strong mechanisms.

### 2.2 Controlled forks are inspection snapshots, not product pins

The fork head records below make agent inspection reproducible. They do **not** automatically replace existing approved donor pins in LiOS.

Any imported path still requires an explicit source version/commit/path, rights check, notices and LiOS destination evidence.

### 2.3 Immediate implementation ownership remains unchanged

Issue #233 already owns the GM-10c/GM-11 core and the SP-01 packaged shared chat-terminal journey.

F0 does not duplicate that implementation.

The donor map is an instruction to the existing owner:

> **before greenfield SP-01 code, inspect the mapped donor mechanisms and reuse/adapt them where they are stronger.**

---

# 3. Controlled mirror inventory

| Controlled mirror | Upstream | Snapshot | Rights posture | Foundation posture |
| --- | --- | --- | --- | --- |
| `kiranvbiim-coder/openclaw` | `openclaw/openclaw` | `0be750916b123c328b8962117213f8c4fd1b2a0a` | MIT | **Foundation-critical** — SP-01/SP-02 direct reuse/adapt/combine |
| `kiranvbiim-coder/cua` | `trycua/cua` | `a7524cfd1d3e959963b43954d43f27c4bd260f08` | root metadata MIT; exact component/path rights must be checked | SP-01/SP-02 reference/adapt when path-cleared |
| `kiranvbiim-coder/TradingAgents` | `TauricResearch/TradingAgents` | `1394a3f72aa4393e1a98f51b382434c4b4c2d972` | Apache-2.0 | Research challenger now; deep assimilation SI-05 |
| `kiranvbiim-coder/FinRobot` | `AI4Finance-Foundation/FinRobot` | `2717499b8e30f242640af08c4ad9afd1113c2d45` | Apache-2.0 root; exact path check on import | Research/output challenger now; deep assimilation SI-05 |
| `kiranvbiim-coder/FinGPT` | `AI4Finance-Foundation/FinGPT` | `fdb04c9a273d1ccc3764b09b8e3ed1e708e57566` | MIT code; model/data rights separate | SI-05-first |
| `kiranvbiim-coder/LangAlpha` | `ginlix-ai/LangAlpha` | `941ca4a18f5a364caf481a6f78cdb040086aa38d` | Apache-2.0 project posture; path check on import | SP-03/SP-04 mechanisms; deeper SI-05/SI-06 |
| `kiranvbiim-coder/dexter-js` | `rodionlim/dexter-js` | `d2efa875c4f7e27f2f11bc59f20db72037725736` | **no root license exposed in repo metadata** | SP-02 reference only until rights/provenance reconciled |
| `kiranvbiim-coder/browser-use` | `browser-use/browser-use` | `a6e103e27d28c390ac6421a6ee8ac21f1b1dfc1c` | MIT | SP-02 browser mechanism donor behind GM-14 |
| `kiranvbiim-coder/qlib` | `microsoft/qlib` | `be725493eb1a6bbb42bf11b37aa7669f59610ff1` | MIT | SI-05-first; pull forward only for concrete blocker |
| `kiranvbiim-coder/graphrag` | `microsoft/graphrag` | `769542fbf1d8e5b4c6a8677fefc34621c87894c5` | MIT | SP-03 challenger/selective adaptation behind P7/P5 |

## 3.1 Dexter provenance exception

The canonical 92 registry entry `dexter` is `virattt/dexter` and records MIT.

The controlled mirror `kiranvbiim-coder/dexter-js` is a fork of **`rodionlim/dexter-js`**, whose GitHub metadata currently exposes no root license.

Therefore:

> **Do not treat the controlled dexter-js fork as if it were the exact registered `virattt/dexter` source.**

Planning, self-validation and bounded-loop mechanisms may be studied. Direct transplantation from `dexter-js` is blocked until its exact license and lineage are documented.

## 3.2 CUA rights exception

The CUA repository root reports MIT in GitHub metadata, but CUA contains multiple product/component areas and has historically carried component-specific/source-available terms.

Therefore:

> **license the exact reusable path/component, not the repository name.**

This is especially important before taking code from Spaces or other separately governed areas.

---

# 4. SP-01 — donor-first queue

**Goal:** packaged macOS shared chat-terminal journey with exact approval, canonical execution, receipts, cancellation/reconnect, persistence and restart/restore.

**Implementation owner:** existing GM-10c/GM-11 lane, especially #233. F0 does not take it over.

## Use first

### OpenClaw — `DIRECT_REUSE / ADAPT`

Inspect before any new equivalent implementation:

- Gateway/session lifecycle;
- exact approval and verdict ordering mechanisms;
- session ownership/routing;
- process/execution lifecycle;
- cancellation and reconnect;
- trust/receipt patterns;
- recovery/restart/Doctor mechanisms;
- device/node lifecycle where it directly supports the MSJ.

Import only through existing GM contracts. Do not import OpenClaw's entire control plane as a second LiOS architecture.

### `@lydell/node-pty` — `DIRECT_REUSE`

Already separately accounted outside the 92 baseline and pinned as an optional backend.

The task is to finish the canonical GM consumer/session path where appropriate — **not** to add another PTY/terminal implementation.

### OPA — `REFERENCE_VALIDATOR / DEFER_WITH_TRIGGER`

Use for policy-model comparison if #233 exposes a real GM-11 policy gap.

Do not replace GM-11 with OPA or create a second permission system merely to integrate a donor.

### OpenTerminal / OpenTerminalUI / HQ TUI — `REFERENCE_VALIDATOR`

Use terminal-session and interaction patterns where useful.

Do not create another terminal/workspace authority.

### CUA — `REFERENCE_VALIDATOR`

Use isolation/driver/evaluation ideas only after exact-path rights verification.

## SP-01 build-new rule

If #233 needs new execution/terminal/approval code, the task record should explicitly show what was inspected in OpenClaw/node-pty/OPA/terminal donors before greenfield code is accepted.

---

# 5. SP-02 — donor-first queue

**Goal:** request → bounded plan → governed tools → inspect/revise → recovery/checkpoint/cancel → persistent result and receipts.

### OpenClaw — `DIRECT_REUSE / ADAPT / COMBINE`

Primary donor for agent/tool/session mechanisms, delegation, recovery, tool-policy patterns, browser lifecycle, coding/runtime interoperability and skills/MCP patterns.

GM-12/13/14 and P13 remain canonical.

### browser-use — `ADAPT / REFERENCE_VALIDATOR`

Use its browser navigation, page-state, action and evaluation mechanisms to improve the existing GM browser system.

Do **not** ship a second browser-agent runtime/control plane next to the existing LiOS/OpenClaw path.

### CUA — `REFERENCE_VALIDATOR / ADAPT`

Use computer-use driver and evaluation mechanisms after path-level rights validation.

### PydanticAI / LangGraphJS — `REFERENCE_VALIDATOR / DEFER_WITH_TRIGGER`

Compare state, tool, planning and recovery patterns only if the current LiOS agent runtime has a reproduced gap.

Do not introduce a second canonical agent state machine.

### Dexter — `REFERENCE_VALIDATOR`

Use planning/self-validation/loop-limit ideas.

The controlled dexter-js fork remains non-importable until provenance/license is cleared.

### assistant-ui / tool-ui — `ADAPT / REFERENCE_VALIDATOR`

Use progress, tool-result and approval interaction patterns through the existing TC/P2 experience.

---

# 6. SP-03 — donor-first queue

**Goal:** real entity/topic → permitted evidence → entitlement/freshness/as-of → contradiction/gaps/unknowns → durable cited Research Artifact → restart/reopen.

Current SI-03 implementation is already deep. The default action is **qualification first**, not adding another research stack.

### Docling — `DIRECT_REUSE`

Already runtime-integrated as an optional document-intelligence pack. Include the existing path in real research qualification instead of replacing it.

### EdgarTools — `DIRECT_REUSE`

Already runtime-integrated for SEC research. Qualify the existing path where the SP-03 scenario uses public-company filings.

### GraphRAG — `REFERENCE_VALIDATOR / ADAPT`

Benchmark only the mechanisms that may improve P7/P5: graph indexing, relationship extraction, graph-aware retrieval, community/relationship summarization and research navigation.

A successful GraphRAG benchmark may lead to selective adaptation.

It may **not** introduce a second entity authority, knowledge store, Project state store, citation system or retrieval authority.

### sqlite-vec — `DEFER_WITH_TRIGGER`

Only activate if a current P7 retrieval benchmark demonstrates a local-vector gap.

### Camelot / pdfplumber / unstructured — `REFERENCE_VALIDATOR / TRIGGERED FALLBACK`

Use the real SP-03 document corpus to determine whether existing Docling extraction fails on tables/layouts. Add a fallback only for a demonstrated gap.

### Splink — `REFERENCE_VALIDATOR`

The existing bake-off already showed value for bulk fuzzy reconciliation but unacceptable ambiguity for primary identity resolution. Use behind P5 for bulk reconciliation only; P5 retains ambiguity/identity authority.

### LangAlpha / TradingAgents — `REFERENCE_VALIDATOR`

Use Living Thesis, persistent research workspace, analyst debate and point-in-time concepts as challengers during SP-03. Deep integration is primarily SI-05 after Research Alpha is accepted.

---

# 7. SP-04 — donor-first queue

**Goal:** real source → canonical living Artifact → edit/analyze → table/chart → export → reopen/round-trip → revision + lineage/citations.

### Univer — `DIRECT_REUSE / ADAPT`

Already partially integrated into P4 spreadsheet editing and P4 revision saves. This is the highest-priority SP-04 donor path to deepen and qualify.

### Dockview — `DIRECT_REUSE`

Already the integrated workspace renderer. Preserve it unless a reproduced defect requires change.

### Tiptap — `ADAPT / IMPORT WITH TRIGGER`

Current state is bridge-only. Promote it to a real document editor only if the SP-04 MSJ requires structured document editing that the current implementation cannot satisfy.

### ECharts — `ADAPT / IMPORT WITH TRIGGER`

The registry deliberately contains overlapping ECharts entries but requires **one** canonical chart runtime. Promote only when the MSJ requires chart depth unavailable in the current P4 path.

### Perspective — `ADAPT / TRIGGERED`

Use for large interactive tabular/data exploration when a benchmark justifies its runtime footprint.

### TanStack Table / Virtual — `ADAPT / TRIGGERED`

Use large-table/virtualization mechanisms if current P4 table performance becomes a measured SP-04 blocker.

### XlsxWriter / python-docx / python-pptx — `CHALLENGER / FALLBACK`

LiOS already has deterministic professional-export paths, including recent DOCX/PDF work. These donors should validate fidelity and act as fallbacks if a concrete professional-format requirement fails. Do not duplicate working exporters simply for donor-count optics.

### React-PDF — `DEFER_WITH_TRIGGER`

Exact license/pin verification is still required in the baseline registry. Evaluate only if the current PDF implementation has a reproduced fidelity/rendering deficiency.

---

# 8. Post-Foundation-first controlled mirrors

These are **not restricted** during the Foundation. They simply have the highest expected return later unless a current Shipping Point exposes a blocker.

| Donor | Primary next epoch | Main value |
| --- | --- | --- |
| Qlib | SI-05 / SP-05 | quant research, features, ML, alpha, backtests, portfolio research |
| FinRobot | SI-05 / SP-05 | deterministic finance operators, provenance, research/report orchestration |
| TradingAgents | SI-05 / SP-05 | parallel specialist analysts, debate, checkpointing, point-in-time workflows |
| FinGPT | SI-05 / SP-05 | finance NLP, sentiment, specialist models/evaluation |
| LangAlpha | SI-05 → SI-06 | Living Thesis, persistent investment workflows, monitors/automation |
| CUA + browser-use | SI-06 / SP-06 | deeper autonomous browser/computer execution and environments |

If one of these solves a concrete SP-01–SP-04 blocker, pull it forward under the normal donor policy.

---

# 9. Immediate execution queue after F0

1. **SP-01:** #233 owner compares current LiOS with OpenClaw + existing node-pty + OPA/terminal references + path-cleared CUA mechanisms, then implements only remaining packaged MSJ gaps.
2. **SP-02:** converge existing GM agent/runtime contracts and benchmark OpenClaw + browser-use + CUA + targeted PydanticAI/LangGraphJS/Dexter mechanisms where measured gaps remain.
3. **SP-03:** qualify current research stack first; use GraphRAG/document donors only where the real corpus demonstrates measurable improvement.
4. **SP-04:** qualify current P4 system first; deepen Univer and promote Tiptap/ECharts/Perspective only for measured professional-work gaps.
5. **Foundation Lock:** reconcile donor provenance/notices, remove duplicate experiments and protect R-SP01 through R-SP04 before aggressive SI-05 expansion.

---

# 10. Definition of F0 completion

F0 is complete when:

- the ten current controlled mirrors have a reproducible snapshot and Foundation disposition;
- the 92 registry has been mined for SP-01–SP-04 leverage rather than treated as passive documentation;
- additional donors remain separately accounted from the historical 92;
- implementation owners can tell which donor to inspect before building each Foundation gap;
- rights/provenance exceptions are explicit;
- no donor selection changes canonical LiOS ownership;
- #192 points active agents to this execution map.

F0 itself does **not** accept any Shipping Point.
