# LiOS Donor Catalog — Primary, Secondary, Other & Discovery Index

**Status:** Canonical human-facing donor discovery/index document  
**Effective:** 2026-10-06  
**Applies to:** All LiOS contributors, coding agents, CA/GM/TC workstreams, SI-01 through SI-07  
**Policy authority:** `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`  
**Machine implementation truth:** `third_party/capability-assimilation.json`  
**Capability-assimilation authority:** `docs/technical/CAPABILITY_ASSIMILATION_WORKSTREAM.md`

---

## 1. Purpose

This file gives agents one obvious place to **discover, classify, add, compare and revisit donor projects** that may strengthen LiOS.

Three separate concepts must remain distinct:

- **Donor policy** answers: *How must LiOS evaluate and reuse donor implementations?*
- **Machine truth registry** answers: *What is actually implemented, packaged and user-accessible?*
- **This catalog** answers: *Which donors should agents know about, how strategically important are they, and what should be inspected next?*

This catalog is intentionally expandable. It is not an installation quota and does not authorize implementation by itself.

> **LiOS owns the product. Donors provide implementation leverage.**

---

## 2. Strategic donor tiers

Donor **tier** describes strategic importance and breadth of expected reuse. It does **not** describe implementation status.

A donor may be `PRIMARY` or `SECONDARY` while still being only `DISCOVERY`, `REFERENCE`, or partially integrated in machine truth.

### Tier 1 — PRIMARY structural donor

A Primary donor contributes broad platform/runtime capability across multiple SI phases and should be inspected deeply before equivalent LiOS-native work is created.

| Donor | Role in LiOS | Main opportunity | Tier rule |
| --- | --- | --- | --- |
| **OpenClaw / Goldmine (`openclaw/openclaw`)** | Primary structural donor/backbone | Home/Gateway mechanics, runtime, devices/nodes, execution, agents, tools, browser/CUA, ACP/coding, skills, MCP, memory, local AI, automation, recovery, diagnostics, placement and related infrastructure | `PRIMARY` — exploit deeply wherever suitable under canonical LiOS authorities |

OpenClaw is the **primary structural donor, not the LiOS architecture**. LiOS Projects, Conversations, Artifacts, entities, deterministic engines, permissions, product UX and other canonical authorities remain LiOS-owned.

OpenClaw must be examined at subsystem/package/mechanism level, not only at whole-product level. Complete useful packages or subsystems may be imported/adapted where policy, rights, architecture, footprint and maintenance fit.

### Tier 2 — SECONDARY strategic / niche donors

Secondary donors are high-leverage projects that may materially strengthen a major LiOS capability, close a difficult niche gap, provide a challenger architecture, or supply mature mechanisms that complement OpenClaw and existing LiOS implementation.

They are **not automatically approved for import**. Each exact repo/path/license/pin must pass donor-policy review before promotion.

#### Current Secondary watchlist

| Catalog ID | Donor / repository | Niche / strategic value for LiOS | Likely SI area | Owner candidate | Current catalog state |
| --- | --- | --- | --- | --- | --- |
| `D+001` | `trycua/cua` | Agent-computer infrastructure; persistent desktops/Spaces concepts; elastic isolated Fleets concepts; local/remote/BYOC computer-use architecture | SI-02, SI-06 | GM browser/CUA, placement, device/runtime | `REVIEWING` — exact component rights must be separated before reuse; architecture/mechanisms may be repurposed even where a subcomponent is not suitable for direct proprietary import |
| `D+002` | `agentdesktop-dev/agentdesktop` | Agent desktop/device fleet governance, managed computer environments and operational control patterns | SI-02, SI-06 | GM CUA / devices / placement | `DISCOVERY` |
| `D+003` | `barry-ran/QuickDesk` | Remote desktop/control, WebRTC and MCP-oriented remote-computer mechanisms | SI-02, SI-06 | GM CUA / Gateway / remote nodes | `DISCOVERY` |
| `D+004` | `CelestoAI/celesto` | Persistent isolated agent computers/workspaces and long-running computer environment patterns | SI-02, SI-06 | GM CUA / sandbox / placement | `DISCOVERY` |
| `D+005` | `stacklok/toolhive` | Secure MCP runtime/hosting, tool isolation, registry/packaging and lifecycle mechanisms | SI-02, SI-07 | P13/GM skills/MCP/plugin authority | `DISCOVERY` |
| `D+006` | `openleash/openleash` | Authorization, proof/audit and governed agent-action ideas that may strengthen permissions/receipts | SI-01, SI-02, SI-07 | GM-11 / trust receipts / governance | `DISCOVERY` |
| `D+007` | `agentgateway/agentgateway` | Agent/LLM/MCP/A2A gateway and routing mechanisms; possible interoperability/traffic-policy ideas | SI-02, SI-06, SI-07 | GM Gateway / P13 | `DISCOVERY` |
| `D+008` | `OpenBB-finance/OpenBB` | Broad finance-data/provider/terminal ecosystem; adapters, provider abstractions and finance capability reference/challenger | SI-03, SI-05 | P5 / P11 / Finance | `DISCOVERY` / compare against existing Finance authority before any import |

Secondary donors should be actively revisited when their capability becomes relevant. Do not leave them as one-off chat references.

### Tier 3 — OTHER capability donors

Other donors are narrower engines, UI components, renderers, data libraries, research libraries, finance libraries, output generators and specialized mechanisms. They may still be extremely important within their domain; `OTHER` means narrower breadth, not lower code quality.

The preserved 92-entry baseline contains many of these. The machine registry remains the truth source for exact status.

### Tier 4 — DISCOVERY / future candidates

Any new promising donor that has not yet been classified becomes a `D+` discovery first. After review it may remain a discovery, become Secondary, be treated as an Other capability donor, be deferred/reference-only, or be rejected with evidence.

There is **no fixed maximum number of donors**. The catalog may grow continuously as better building blocks are discovered.

---

## 3. Authority and no-duplication rule

This document does **not** replace or redefine the canonical donor policy.

All implementation decisions continue to follow:

> `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

The preserved **92-entry donor baseline** remains in:

> `third_party/capability-assimilation.json`

That JSON is the machine-readable implementation-truth authority. Do not change its preserved baseline accounting merely because a new discovery is added here.

Catalog membership or tier never proves `integrated`, `packaged`, `user accessible`, `Shipping Point accepted`, or `release proven`.

---

## 4. Mandatory agent behavior

Before designing or building any substantial capability, agents must:

1. inspect the relevant canonical LiOS implementation first;
2. inspect **Primary** donor subsystems relevant to the task;
3. inspect relevant **Secondary** donors and niche mechanisms;
4. inspect `third_party/capability-assimilation.json` for the 92 baseline and current machine truth;
5. inspect relevant **Other** capability donors and new `D+` discoveries;
6. apply the canonical donor policy;
7. compare multiple donors where meaningful overlap exists;
8. prefer reuse/adaptation/repurposing/combination over unnecessary greenfield work;
9. map selected implementations into the existing canonical LiOS owner;
10. preserve licensing, provenance, notices, pins and material-modification evidence;
11. build new only when donor reuse/adaptation is unsuitable for a concrete reason.

Use the repository-wide disposition sequence:

> **ANALYZE → DECOMPOSE → REUSE → ADAPT → REPURPOSE → COMBINE → GENERALIZE → INNOVATE → WRAP → BUILD LAST → REJECT ONLY WITH EVIDENCE**

A donor's original domain is not a limitation. Scheduling, replay, graph logic, collaboration, state machines, browser control, checkpoints, repair systems, plugin packaging, worker pools, caching, rendering, data engines and similar mechanisms may be repurposed elsewhere in LiOS.

---

## 5. Catalog states

Tier and state are separate.

| State | Meaning |
| --- | --- |
| `BASELINE` | Already represented in the preserved 92-entry machine-truth baseline. |
| `SUPPLEMENTAL` | Already tracked outside the preserved 92 baseline. |
| `DISCOVERY` | Newly identified; exact license/pin/path/fit still requires review. |
| `REVIEWING` | Active donor intelligence analysis is underway. |
| `PROMOTE` | Review indicates likely value; create/update the appropriate CA/GM/P task and machine-truth record without changing baseline accounting. |
| `DEFER` | Useful, but blocked by an explicit dependency or delivery trigger. |
| `REFERENCE` | Useful as a validator/pattern/reference, not currently selected for runtime integration. |
| `REJECTED` | Rejected with concrete evidence, including rights or architecture constraints. |

---

## 6. Other donor map — human index

The exact full baseline and truth status must always be read from `third_party/capability-assimilation.json`. The lists below are a fast human index of major capability donors already present in LiOS planning, implementation or CA analysis.

### 6.1 Runtime, agents, tools, coding and orchestration

| Donor / project | Typical LiOS opportunity | Primary owner family | Catalog posture |
| --- | --- | --- | --- |
| node-pty | PTY/native terminal execution | GM-10/GM-11 | `SUPPLEMENTAL` |
| assistant-ui | conversation interaction patterns/components | P2 / GM-23 | `BASELINE` |
| tool-ui | tool-result interaction patterns | P2 / GM-23 | `BASELINE` |
| PydanticAI | agent/tool/runtime patterns | GM agent runtime | `BASELINE` |
| LangGraphJS | graph/agent orchestration patterns | GM agent runtime | `BASELINE` |
| TradingAgents | finance-oriented multi-agent mechanisms | GM / P11 | `BASELINE` |
| Dexter | agent/research/finance mechanisms; rights must remain explicit | GM / P11 | `BASELINE` |
| LangAlpha | subagent/finance workflow mechanisms | GM / P11 | `BASELINE` |
| fin-agent | finance-agent patterns | GM / P11 | `BASELINE` |
| OpenTerminal | terminal/operator patterns | GM | `BASELINE` |
| OpenTerminalUI | terminal/operator UI patterns | GM / TC | `BASELINE` |
| HQ TUI | terminal/TUI interaction ideas | GM / TC | `BASELINE` |

### 6.2 Artifacts, spreadsheets, charts, editors, graphs and timelines

| Donor / project | Typical LiOS opportunity | Primary owner family | Catalog posture |
| --- | --- | --- | --- |
| Univer | spreadsheet/editor runtime | P4 | `BASELINE` |
| Perspective | high-volume data exploration/table visualization | P4 | `BASELINE` |
| Apache ECharts | advanced charting | P4 | `BASELINE` |
| Tiptap | structured rich-text/document editing | P4 | `BASELINE` |
| Dockview | workspace/panel layout | P4 / TC | `BASELINE` |
| TanStack Table / Virtual | large tables and virtualization | P4 | `BASELINE` |
| xyflow | node/flow/graph interaction | P4 | `BASELINE` |
| Monaco | code/editor surfaces | P4 / GM coding | `BASELINE` |
| AntV G6 | entity and relationship graphs | P4 | `DISCOVERY` |
| vis-timeline | evidence/event/research timelines | P4 | `DISCOVERY` |
| Mermaid | generated diagrams | P4 | `DISCOVERY` |
| MapLibre | geo/map Artifact capability | P4 | `DISCOVERY` |
| deck.gl | large geo/visual analytics | P4 | `DISCOVERY` |
| React-PDF | professional PDF rendering fallback | P11 Outputs | `DISCOVERY` |

### 6.3 Data, SQL, interoperability, entity resolution and analytical substrate

| Donor / project | Typical LiOS opportunity | Primary owner family | Catalog posture |
| --- | --- | --- | --- |
| DuckDB | local analytical SQL/Parquet/data execution | P5 / P11 Data Lab | `BASELINE` |
| Polars | fast dataframe execution | P11 Data Lab | `BASELINE` |
| Apache Arrow | columnar interoperability | P11 Data Lab | `BASELINE` |
| Apache DataFusion | analytical query-engine reference/alternative | P11 Data Lab | `BASELINE` |
| SQLGlot | SQL parsing/transpilation | P5 / P11 Data Lab | `BASELINE` |
| Pandera | dataframe/data validation | P5 / P11 | `BASELINE` |
| sqlite-vec | local vector search | P5 / GM memory/retrieval | `BASELINE` |
| Splink | entity resolution / probabilistic linkage | P5 | `DISCOVERY` |
| SciPy | scientific numerical routines | P11 | `BASELINE` |
| statsmodels | statistical/econometric routines | P11 | `BASELINE` |
| scikit-learn | ML/statistical utilities | P11 | `BASELINE` |

### 6.4 Research, filings, documents and extraction

| Donor / project | Typical LiOS opportunity | Primary owner family | Catalog posture |
| --- | --- | --- | --- |
| EdgarTools | SEC filings/search/research | P5 / P11 Research | `BASELINE` |
| Docling | document parsing/extraction | P11 Research & Documents | `BASELINE` |
| Arelle | XBRL validation/processing | P11 Research & Documents | `BASELINE` |
| Camelot | PDF table extraction reference | P11 Research & Documents | `BASELINE` |

### 6.5 Finance, quant, portfolio, valuation, risk and strategy

| Donor / project | Typical LiOS opportunity | Primary owner family | Catalog posture |
| --- | --- | --- | --- |
| QuantLib | fixed income/derivatives/quant analytics | P11 | `BASELINE` |
| FinanceToolkit | fundamentals/finance analytics | P11 | `BASELINE` |
| skfolio | portfolio construction/risk | P11 Portfolio | `BASELINE` |
| Riskfolio-Lib | portfolio optimization/risk | P11 Portfolio | `BASELINE` |
| PyPortfolioOpt | portfolio optimization reference/challenger | P11 Portfolio | `BASELINE` |
| QuantStats | portfolio/performance reporting | P11 | `BASELINE` |
| CVXPY | optimization substrate | P11 Portfolio | `BASELINE` |
| ORE | risk/valuation mechanisms | P11 | `BASELINE` |
| Strata | market/risk/pricing reference or selected mechanisms | P11 | `BASELINE` |
| py_vollib | options/volatility calculations | P11 Derivatives | `BASELINE` |
| Qlib | quant research/modeling workflows | P11 | `BASELINE` |
| StatsForecast | forecasting | P11 | `BASELINE` |
| XGBoost | modeling/forecasting | P11 | `BASELINE` |
| Optuna | optimization/hyperparameter search | P11 | `BASELINE` |
| LEAN | strategy/backtest/execution architecture | P11 Strategy & Backtest | `BASELINE` |
| Brue | strategy/runtime/conformance mechanisms | P11 Strategy & Backtest | `BASELINE` |
| LSE Terminal | finance terminal/reference capabilities | P11 / CA | `BASELINE` |
| backtest-kit | strategy/backtest mechanisms | P11 Strategy & Backtest | `BASELINE` |
| bt | portfolio/backtest reference | P11 Strategy & Backtest | `BASELINE` |
| CCXT | broker/exchange connector patterns | P11 Broker & Execution | `BASELINE` |
| backtesting.py | strategy/backtest reference; current rights posture blocks proprietary-core import | P11 Strategy & Backtest | `REJECTED` in current registry |
| backtrader | strategy/backtest reference; current rights posture blocks proprietary-core import | P11 Strategy & Backtest | `REJECTED` in current registry |

### 6.6 Professional outputs and office-document generation

| Donor / project | Typical LiOS opportunity | Primary owner family | Catalog posture |
| --- | --- | --- | --- |
| XlsxWriter | XLSX output | P11 Reporting & Modeling | `BASELINE` |
| python-docx | DOCX output | P11 Reporting & Modeling | `BASELINE` |
| python-pptx | PPTX output | P11 Reporting & Modeling | `BASELINE` |

### 6.7 Local AI, voice and multimodal

| Donor / project | Typical LiOS opportunity | Primary owner family | Catalog posture |
| --- | --- | --- | --- |
| Ollama | user-owned/local model provider path | GM-22 | `BASELINE` |
| llama.cpp | local model runtime | GM-22 | `DISCOVERY` |
| MLX | Apple-silicon local model runtime/acceleration | GM-22 | `DISCOVERY` |
| whisper.cpp | local speech-to-text | P12 / GM | `BASELINE` |

---

## 7. New Donor Inbox — continue adding here

Use the next available `D+` ID for newly discovered donors that are not already represented above or in the preserved 92-entry baseline.

Do not add a donor merely because it is popular. Add it because there is a plausible LiOS capability, subsystem or mechanism worth evaluating.

| Catalog ID | Donor / repository | Candidate capability or mechanism | Likely SI phase | Canonical owner candidate | License status | Tier candidate | State | Why it may matter | Next evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `D+009` | `promptfoo/promptfoo` | Offline AI/agent evaluation and red-team validation; initial local golden-routing adapter | SI-02 / SI-07 | GM/P2 evaluation + CA provenance | MIT LICENSE observed at upstream; full dependency/edition review pending | `OTHER` | `DISCOVERY` | Separate benchmark surface for existing LiOS golden routes without modifying runtime/permissions | Exact CLI pin and license audit, native Node compatibility, run real optional Promptfoo CLI, compare baseline and validate AI/citation/permission tests independently |

### ID and tier rule

- Preserve the 92-entry baseline IDs in the machine registry.
- New discoveries use `D+001`, `D+002`, ... for catalog discussion/indexing.
- A `D+` ID is not an implementation authority and does not change the 92 baseline count.
- `PRIMARY`, `SECONDARY`, `OTHER` and `DISCOVERY` are strategic catalog tiers, not machine truth states.
- A donor can move between Secondary/Other/Discovery as evidence improves without changing architecture authority.
- Promotion to real implementation requires the relevant CA/GM/P task plus exact machine-truth accounting, pin/license/provenance and acceptance evidence.

---

### D+009 — Promptfoo intake snapshot (2026-10-24)

- **Identity and observed source:** [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo), observed main HEAD `c0b88a324175c60019cc80de1b2e32b4c849d4c3`. Observation is **not** a selected import pin.
- **Original purpose:** Developer evaluations, prompt/agent regression testing and adversarial assessments.
- **Interesting mechanism:** Extensible custom JavaScript provider + test-case assertions. Initial adapter invokes only existing LiOS golden routing fixtures through the real planner, with no provider/model/network use.
- **LiOS value:** Complement `src/evals/golden` with an optional external test matrix, starting with known regression risk (company/topic routing). Later consider prompt-injection/citation/consent tests *only with explicit harness and approved inputs*.
- **Overlap:** LiOS already owns `src/evals` and evaluation fixture authority. Do not create a competing test truth registry; this is an optional *consumer* of the existing baseline, not a new product evaluator.
- **Potential transformations:** Adapt the provider interface to other LiOS acceptance cases while retaining source-grounded tests and approvals. Promptfoo package itself is **not** imported or executed by the initial prototype.
- **License and rights:** Repository-level `LICENSE` observed as MIT; exact dependency tree, CLI distribution, subdirectories, editions, and network/telemetry features remain unapproved for shipping.
- **Runtime/security:** Promptfoo currently documents Node >=22.22 while LiOS supports Node >=22.12. CLI execution is optional, isolated, developer-only; normal product dependencies, CI and user-owned Home are unchanged. No paid inference, uploaded data, or external model access.
- **Integration state:** Optional adapter/config + Node source unit tests proposed in ENG-05. Do **not** promote `third_party/capability-assimilation.json` beyond its 92 baseline or claim `runtime_integrated`/shipping.
- **Next gate:** Independent CA/GM/P2 review, select exact CLI pin and verify its rights/footprint, execute actual Promptfoo eval on supported Node, compare measured results to `npm run eval:golden`, and only then decide `ADAPT` versus `REFERENCE_VALIDATOR` or `DEFER_WITH_TRIGGER`.

---

## 8. Minimum donor intake record

For every new `D+` entry, record at least:

- repository/name and exact upstream identity;
- original product purpose;
- promising subsystems/components;
- promising underlying mechanisms;
- possible LiOS transformations/repurposing;
- expected SI phase(s);
- likely canonical `GM/TC/CA/P*` owner;
- preliminary license/rights posture;
- security/privacy/networking implications;
- dependency/footprint/packaging implications;
- overlap with OpenClaw, existing LiOS code and other donors;
- direct reuse vs adapt vs combine hypothesis;
- concrete user/product benefit;
- proposed tier and next evidence required.

Do not claim implementation truth here.

---

## 9. Promotion gate — catalog to implementation work

A catalog donor may move toward implementation only after these questions are answered:

1. **Gap:** what real LiOS capability or quality gap does it address?
2. **Existing truth:** is the capability already implemented well enough elsewhere?
3. **Primary comparison:** does OpenClaw or another existing Primary path already solve it strongly?
4. **Secondary comparison:** does a niche Secondary donor offer a materially stronger mechanism?
5. **Donor value:** what exact package/subsystem/mechanism is valuable?
6. **Rights:** is the exact code/path/license usable for the intended proprietary/commercial distribution model?
7. **Authority:** which existing LiOS owner remains canonical?
8. **Integration:** can the donor fit behind that authority without creating a competing router/store/runtime/state/permission/entity/Artifact/engine system?
9. **Packaging:** can LiOS make it zero-setup or appropriately opt-in?
10. **Evidence:** what tests/benchmarks/user journey will prove benefit?
11. **Maintenance:** what pin/update/rollback/removal strategy exists?
12. **Disposition:** `DIRECT_REUSE`, `IMPORT`, `ADAPT`, `REPURPOSE`, `COMBINE`, `GENERALIZE`, `INNOVATE`, `REFERENCE_VALIDATOR`, `DEFER_WITH_TRIGGER`, or `REJECT_WITH_EVIDENCE`?

Only then should implementation begin under the appropriate SI workstream and canonical owner.

---

## 10. Cross-donor combination is encouraged

Agents should not assume one donor must solve an entire capability.

Examples:

- **OpenClaw execution/agent substrate + ToolHive MCP isolation + LiOS P13 authority**;
- **OpenClaw CUA + Cua/AgentDesktop/Celesto mechanisms + LiOS GM-11 permissions/receipts**;
- **OpenClaw Gateway/device fabric + QuickDesk remote/WebRTC mechanisms + LiOS placement policy**;
- **OpenClaw tool/agent runtime + OpenLeash-style proof/audit mechanisms + canonical LiOS exact-operation authority**;
- **OpenClaw Gateway + AgentGateway interoperability ideas + P13 MCP/agent capability publication**;
- entity resolution engine + P5 identity + graph visualization + timeline Artifact;
- deterministic finance engine + P11 reconciliation + Univer workbook + ECharts visualization + python-pptx output;
- local-model runtime + BYOAI provider routing + user-owned Home/device placement.

Combination must still preserve one canonical LiOS authority per concept.

---

## 11. What agents must never do

Do not:

- treat Primary/Secondary classification as proof of integration;
- install every donor to maximize donor count;
- rewrite mature permissive functionality without first evaluating reuse;
- reject a donor merely because its original product purpose differs from LiOS;
- introduce duplicate runtimes, stores, routers, permission systems, Artifact authorities, entity authorities, engine authorities, plugin authorities or memory systems;
- import GPL/AGPL/source-available/custom-restricted code into proprietary core without an explicit compatible legal decision;
- silently change the preserved 92-entry baseline accounting;
- let donor branding/product concepts leak into normal LiOS UX;
- create a new roadmap/task family merely because a new donor is discovered;
- claim Shipping Point/release readiness from donor presence alone.

---

## 12. Agent handoff requirement for donor work

Any issue/PR that uses or evaluates a donor should identify:

- donor/catalog ID and strategic tier;
- exact upstream repo/pin/path when known;
- donor policy disposition;
- SI phase/workstream;
- canonical implementation owner;
- current machine truth status and target truth status;
- selected subsystem/mechanism;
- Primary/Secondary/Other overlaps or challengers considered;
- licensing/provenance/notices;
- files/contracts touched;
- validation/benchmark evidence;
- packaging/provisioning impact;
- user-visible MSJ contribution;
- remaining gaps.

If a useful new donor is discovered during implementation, add it to the **New Donor Inbox** rather than leaving it only in chat, an issue comment or an agent's local notes.

---

## 13. Governing principle

> **Primary donors provide broad structural leverage.**  
> **Secondary donors provide strategic and niche leverage.**  
> **Other donors provide focused capability depth.**  
> **Discovery remains open-ended as LiOS finds stronger building blocks.**  
> **The donor policy remains the reuse authority.**  
> **The machine registry remains truthful about actual implementation.**  
> **LiOS architecture remains canonical throughout.**