# LiOS Secondary Donor Watchlist — Strategic & Niche Capability Intelligence

**Status:** Canonical human-facing Secondary donor research/watchlist  
**Effective:** 2026-10-06  
**Parent catalog:** `docs/technical/LIOS_DONOR_CATALOG.md`  
**Donor-policy authority:** `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`  
**Machine implementation truth:** `third_party/capability-assimilation.json`  
**Execution authority:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`

---

## 1. Purpose

This watchlist preserves aggressive donor research for **Secondary** projects: high-leverage niche donors, challenger architectures and mature mechanisms that can materially strengthen LiOS without replacing the Primary structural donor, OpenClaw/Goldmine, or any canonical LiOS authority.

A donor appearing here means **inspect, compare, decompose and potentially reuse/repurpose**. It does **not** mean integrated, approved for import, packaged, user-accessible or Shipping-Point accepted.

The preserved 92-entry baseline in `third_party/capability-assimilation.json` remains unchanged. `D+` IDs are catalog IDs only.

> **Primary donor first where relevant; Secondary donors deepen or challenge specific mechanisms; LiOS remains the architecture.**

---

## 2. Mandatory use by agents

Before substantial greenfield work, agents should inspect:

1. current LiOS implementation and canonical owner;
2. relevant OpenClaw/Goldmine subsystem(s);
3. relevant Secondary donors in this watchlist;
4. relevant 92-baseline/Other donors in the machine registry and main catalog;
5. only then decide whether to import, adapt, combine, repurpose, reference, defer or build new.

Use the repository donor-policy sequence:

> **ANALYZE → DECOMPOSE → REUSE → ADAPT → REPURPOSE → COMBINE → GENERALIZE → INNOVATE → WRAP → BUILD LAST → REJECT ONLY WITH EVIDENCE**

Every implementation still requires exact upstream pin/path, exact license/rights check, provenance, canonical-owner mapping, security/footprint review and validation evidence.

---

## 3. Secondary donor map

### A. Agent computers, sandboxes, browser, CUA and coding

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+001` | `trycua/cua` | Cross-OS computer-use drivers, persistent computer environments, Spaces/Fleets concepts, virtualization and benchmark mechanisms | SI-02 / SI-06; GM CUA, placement, devices | MIT at repo level; **REVIEWING**. Verify each selected subcomponent/model/asset separately. |
| `D+002` | `agentdesktop-dev/agentdesktop` | Agent-desktop visibility and fleet-management/control patterns | SI-02 / SI-06; GM CUA/devices | Apache-2.0; `DISCOVERY` |
| `D+003` | `barry-ran/QuickDesk` | Remote desktop/control, WebRTC and MCP-oriented remote-computer mechanisms | SI-02 / SI-06; GM Gateway/CUA/nodes | MIT; `DISCOVERY` |
| `D+004` | `CelestoAI/celesto` | Persistent isolated computers/workspaces for long-running agents | SI-02 / SI-06; GM sandbox/placement | Apache-2.0; `DISCOVERY` |
| `D+009` | `e2b-dev/E2B` | Secure agent sandboxes, code interpreter, templates/builds and isolation mechanics | SI-02 / SI-06; GM execution/sandbox/placement | Apache-2.0; **high-priority review** |
| `D+010` | `daytonaio/daytona` | Secure/elastic AI-generated-code sandbox architecture | SI-02 / SI-06 | Repository currently archived and root license metadata unclear; `REFERENCE` until maintained successor/rights are resolved |
| `D+011` | `browser-use/browser-use` | Mature browser-agent/Playwright patterns, navigation/actions/extraction and browser-loop behavior | SI-02.13; GM browser | MIT; **high-priority challenger/complement** |
| `D+012` | `browserbase/stagehand` | AI + deterministic browser automation, repeatable actions/extraction and self-healing browser mechanisms | SI-02.13; GM browser | MIT observed during research; exact pin/path verification required |
| `D+013` | `simular-ai/Agent-S` | GUI/CUA grounding, planning, memory and cross-platform computer-agent patterns | SI-02.14; GM CUA | Apache-2.0; **high-priority CUA challenger** |
| `D+014` | `aaif-goose/goose` | General-purpose local agent with ACP/MCP plus install/execute/edit/test workflows | SI-02.10/.17; GM agent/ACP/P13 | Apache-2.0; **high-priority ACP/coding comparison** |
| `D+015` | `Aider-AI/aider` | Repo-map/context selection, terminal coding, edit/patch/test workflows | SI-02.10; GM coding | Apache-2.0; `REVIEWING` |
| `D+034` | `huggingface/smolagents` | Small code-thinking agent kernel and tool/code-execution patterns useful as a simplicity challenger | SI-02; GM agent runtime | Apache-2.0; `DISCOVERY` |
| `D+035` | `open-browser-use/open-browser-use` | Local authenticated browser/profile attachment and browser-control ideas | SI-02.13; GM browser | MIT; small/new project, `DISCOVERY` |

### B. MCP, tools, connectors, gateways and authorization

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+005` | `stacklok/toolhive` | MCP server lifecycle, isolation, registry/packaging, auth/security and operational management | SI-02.17 / SI-07; P13/GM | Apache-2.0; **high-priority MCP complement** |
| `D+006` | `openleash/openleash` | Agent authorization, policy, proof/audit and verifiable authority patterns | SI-01 / SI-02 / SI-07; GM-11/trust | Apache-2.0; **high-priority governance challenger** |
| `D+007` | `agentgateway/agentgateway` | Agent/LLM/MCP/A2A traffic gateway, routing, interoperability and policy mechanisms | SI-02 / SI-06 / SI-07; GM Gateway/P13 | Apache-2.0; `REVIEWING` |
| `D+023` | `ComposioHQ/composio` | Large toolkit ecosystem, tool search, auth/context, sandboxed workbench and MCP exposure | SI-02 / SI-06; P13/connectors | MIT at repo level; hosted/provider dependencies must remain optional/user-owned |
| `D+025` | `Portkey-AI/gateway` | Model routing, retries/fallbacks, load balancing, observability, guardrails and MCP gateway patterns | SI-06; existing provider/model authority | MIT; **mechanism donor only — never a second provider authority** |
| `D+030` | `openziti/mcp-gateway` | Zero-trust MCP aggregation/filtering, cryptographic identity, mTLS, per-client isolation and tool-level policy | SI-02.17 / SI-07; P13/GM security | Apache-2.0; **high-value niche security donor** |
| `D+031` | `modelcontextprotocol/registry` | MCP discovery, publishing, namespace and registry metadata mechanisms | SI-02.17 / SI-07; P13 | GitHub metadata reports `NOASSERTION`; exact file-level rights required before import |
| `D+032` | `MCPJam/inspector` | MCP inspection/testing/evals/debugging/OAuth/JSON-RPC validation ideas | SI-02.17 / SI-07; P13/quality | `DISCOVERY`; verify exact current license/pin before direct reuse |
| `D+024` | `BerriAI/litellm` | Broad model gateway, provider normalization, routing, cost, guardrail and load-balancing patterns | SI-06; model/provider authority | GitHub metadata reports `NOASSERTION`; `REFERENCE/REVIEW` until exact component-license boundary is proved |

### C. Memory, retrieval and research intelligence

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+016` | `letta-ai/letta-code` | Stateful-agent memory, identity, learning and long-lived context mechanics | SI-03; GM memory | Apache-2.0; **high-priority memory challenger** |
| `D+017` | `mem0ai/mem0` | Production-grade agent memory, persistence and memory-management patterns | SI-03; GM memory | Apache-2.0; **high-priority memory donor** |
| `D+018` | `deepset-ai/haystack` | Retrieval/RAG/routing/memory/generation pipelines, semantic search and MCP | SI-03; research/retrieval | Apache-2.0; **high-priority research pipeline donor** |
| `D+019` | `assafelovic/gpt-researcher` | Deep-research decomposition, multi-source web research, report generation and MCP patterns | SI-03; research | Apache-2.0; **high-priority deep-research challenger** |
| `D+033` | `microsoft/graphrag` | Graph-based retrieval, entity/community graph and global/local search mechanisms | SI-03; entity/research | MIT; repo metadata marks `activeRepoStatus:false`, so use as `REFERENCE/selected-mechanism` unless maintenance posture changes |

### D. Durable workflows, automation and orchestration

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+020` | `temporalio/temporal` | Durable execution, workflow history, signals, timers, retries and deterministic recovery semantics | SI-06; LiOS tasks/automations | MIT; **high-value mechanism donor**, not a second task authority |
| `D+021` | `triggerdotdev/trigger.dev` | Durable AI workflows, background jobs, scheduler, orchestration and MCP/self-host patterns | SI-06; tasks/automations | Apache-2.0; **high-priority automation challenger** |
| `D+022` | `hatchet-dev/hatchet` | Event-driven durable workflows, queues, concurrency, DAGs and background-agent tasks | SI-06; tasks/automations | MIT; **high-priority automation challenger** |
| `D+037` | `PrefectHQ/prefect` | Resilient workflow/data orchestration and operational scheduling mechanics | SI-03 / SI-05 / SI-06 | Apache-2.0; `DISCOVERY` |
| `D+038` | `dagster-io/dagster` | Data-asset orchestration, lineage, observability and scheduling | SI-03 / SI-05 / SI-06 | Apache-2.0; `DISCOVERY` |

### E. Local AI and model/runtime infrastructure

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+026` | `mudler/LocalAI` | Local multimodal runtime across LLM/vision/voice/image/video and hardware backends | SI-06; GM-22 | MIT; **high-priority local-AI challenger/complement** |

### F. User-owned networking, multi-device and local-first continuity

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+027` | `juanfont/headscale` | Self-hosted mesh-control, node identity/routing/ACL patterns for user-owned device topology | SI-06; GM device/Gateway | BSD-3-Clause; **high-value mechanism donor** |
| `D+028` | `automerge/automerge` | CRDT/local-first/offline concurrent edits and automatic merge | SI-04 / SI-06; P4/Project continuity | MIT; **high-priority local-first challenger** |
| `D+029` | `yjs/yjs` | Collaborative CRDT/synchronization mechanisms | SI-04 / SI-06; P4 | `REVIEW`; verify exact current LICENSE/path before import |
| `D+036` | `electric-sql/electric` | Postgres sync/replication and local-first data synchronization mechanisms | SI-04 / SI-06; data/device continuity | Apache-2.0; **high-priority sync challenger** |

### G. Multi-agent/general agent challengers

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+039` | `camel-ai/camel` | Multi-agent coordination, role/task decomposition and agent-society research patterns | SI-02.08/.09; GM agent runtime | Apache-2.0; `REFERENCE/CHALLENGER` — do not create a second agent stack |

### H. Finance intelligence / finance-native agent challengers

| ID | Repository | Why LiOS should inspect it | SI / owner | Preliminary rights & posture |
| --- | --- | --- | --- | --- |
| `D+008` | `OpenBB-finance/OpenBB` | Broad provider/data/terminal ecosystem, adapters and finance capability benchmarking | SI-03 / SI-05; P5/P11 | `REVIEW`; exact current package/path licensing must be established before import |
| `D+040` | `heurist-network/heurist-finance` | Finance-native agent skills/research/terminal patterns and agent-facing financial workflows | SI-05; Finance/P11 | MIT; new/small project, `DISCOVERY/REFERENCE` pending deep analysis |

---

## 4. Reference-only / rights-restricted / lifecycle-constrained challengers

These projects may contain valuable mechanisms, but they must **not** be treated as ordinary proprietary-core import candidates under the currently observed posture.

| Repository | Reason for restricted posture | Useful reference value |
| --- | --- | --- |
| `skyvern-ai/skyvern` | AGPL-3.0 | Browser workflow, vision/DOM/browser-agent mechanisms |
| `spacedriveapp/spacedrive` | Functional Source License / non-standard commercial terms | Local-first distributed filesystem, sync and device concepts |
| `khoj-ai/khoj` | AGPL-3.0 | Personal research, documents/web search, agents and automations |
| `Fincept-Corporation/FinceptTerminal` | AGPL-family licensing | Finance-terminal capability/UX benchmark |
| `MikkoParkkola/mcp-gateway` | PolyForm Noncommercial in current research | Meta-tool, MCP aggregation and tool-poisoning/security ideas |
| `n8n-io/n8n` | Sustainable Use/fair-code terms | Workflow UX, connectors, triggers/actions and orchestration reference |
| `windmill-labs/windmill` | AGPL | Workflow/job/automation and operator UX reference |
| `continuedev/continue` | Maintenance/lifecycle concern in current research | Coding-agent/editor/context patterns |
| `daytonaio/daytona` | Archived and current root license metadata unresolved | Sandbox architecture and lifecycle reference |
| `microsoft/graphrag` | MIT but repository metadata marks active status false | GraphRAG mechanisms/reference rather than strategic runtime dependency |

Reference-only classification does not prohibit learning, benchmarking or clean-room architectural inspiration where legally appropriate. It does prohibit silently treating restricted code as import-ready.

---

## 5. Current highest-value comparison clusters

Agents should compare donors as **clusters**, not one-by-one in isolation:

### SI-02 browser / computer use
`OpenClaw browser/CUA` + `Cua` + `browser-use` + `Stagehand` + `Agent-S` + `open-browser-use` + `AgentDesktop` + `Celesto`.

Goal: choose/compose the strongest browser and computer-use mechanics while retaining GM-11 permission authority, canonical cancellation, placement, receipts and LiOS product UX.

### SI-02 coding / ACP
`OpenClaw ACP/agent-core` + `Goose` + `Aider` + `smolagents` + existing Codex ACP work.

Goal: improve repo understanding, context selection, read/edit/test loops and protocol lifecycle without adding another run registry, session store or permission authority.

### SI-02 MCP / tools / security
`OpenClaw MCP/skills` + `ToolHive` + `OpenZiti MCP Gateway` + `AgentGateway` + `Composio` + official MCP Registry + MCPJam.

Goal: secure discovery/publication, isolation, authentication, remote access, testing and tool lifecycle behind P13/GM canonical authority.

### SI-03 memory / research
`OpenClaw memory/Dreaming` + `Letta` + `Mem0` + `Haystack` + `GPT Researcher` + GraphRAG.

Goal: durable memory, research decomposition, retrieval, entity/evidence graphs and cited durable research without a second memory or entity authority.

### SI-06 durable automation
`OpenClaw automation/recovery` + `Temporal` + `Trigger.dev` + `Hatchet` + `Prefect` + `Dagster`.

Goal: durable tasks, retries, event triggers, schedules, resumability and data-workflow lineage behind LiOS Automations.

### SI-06 model/runtime routing
`OpenClaw local AI/provider seams` + `LocalAI` + existing Ollama/llama.cpp/MLX + `Portkey Gateway` + LiteLLM as rights-reviewed reference.

Goal: BYOAI/local AI/model routing with no second provider authority.

### SI-06 multi-device / local-first
`OpenClaw nodes/devices` + `Headscale` + `Automerge` + `Yjs` + `Electric` + QuickDesk remote mechanisms.

Goal: user-owned device reachability, offline continuity, sync and remote placement without introducing a vendor data/runtime relay.

### SI-05 Finance intelligence
Existing P5/P11 + 92 finance donors + `OpenBB` + `Heurist Finance` and other future finance-native niche discoveries.

Goal: use finance donors as provider/capability/agent challengers while preserving P5 identity, P11 deterministic engine authority and Finance Intelligence-to-Action contracts.

---

## 6. Promotion rule

A Secondary donor becomes implementation work only when an active canonical task records:

- exact gap and user benefit;
- exact repo + commit/tag + selected path/package;
- verified license/rights for that exact material;
- Primary/Secondary/Other alternatives compared;
- selected disposition (`DIRECT_REUSE`, `IMPORT`, `ADAPT`, `REPURPOSE`, `COMBINE`, `GENERALIZE`, `INNOVATE`, `REFERENCE_VALIDATOR`, `DEFER_WITH_TRIGGER`, `REJECT_WITH_EVIDENCE`);
- canonical LiOS owner and non-duplication boundary;
- security/privacy/networking/footprint implications;
- packaging/provisioning strategy;
- tests/benchmarks and Shipping-Point contribution;
- machine-registry accounting where implementation truth changes.

Do not bulk-integrate the watchlist. Pull donors into work **when the capability becomes relevant** and integrate only the useful subsystem/mechanism.

---

## 7. Continuous discovery rule

Secondary research is intentionally open-ended. New promising niche repositories should receive the next `D+` ID and be added here rather than being lost in chat history.

Research priorities:

1. new agent-computer/sandbox/remote-node runtimes;
2. browser/CUA reliability and verification;
3. MCP security, registries, tool isolation and connector ecosystems;
4. durable execution/recovery/automation;
5. memory, research, evidence, retrieval and knowledge graphs;
6. local AI/model runtime/routing;
7. local-first/offline/multi-device synchronization;
8. professional Artifact/work-product engines;
9. finance-native data/research/model/action agents and deterministic engines;
10. diagnostics, security, packaging and self-repair mechanisms.

Popularity is not enough. A new entry must offer a plausible LiOS subsystem, mechanism, benchmark or challenger value.

---

## 8. Governing rule

> **OpenClaw is Primary.**  
> **Secondary donors are aggressively researched for niche and strategic leverage.**  
> **Other donors provide focused capability depth.**  
> **Restricted donors may inform but do not silently enter proprietary core.**  
> **The 92-entry machine registry remains implementation truth.**  
> **LiOS canonical authorities remain singular.**