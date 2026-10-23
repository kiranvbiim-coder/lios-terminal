# LiOS UI Innovation Lab — Beyond the Existing Donor Catalog

**Discovery date:** 2026-10-23  
**Owner direction:** Go beyond the existing donor list; harvest and combine *complete useful* OSS UI and UX packages, rather than following a conventional clone-and-reskin plan. Innovation must be visible in real user journeys.  
**Authority:** AGENTS.md; docs/LIOS_UX_SYSTEM.md; docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md; docs/PENDING_WORK.md; issue #91.  
**Status:** Evidence-backed **research + prototype selection** only. No package imported, licensed payload redistributed, production UX deployed or shipping/release acceptance claimed by this document.

## 1. The innovation thesis: LiOS is an adaptive intelligence workspace

**Do not copy an entire competitor interface or merely decorate the Chat UI.**

LiOS should turn a single natural-language intent into the **best relevant interactive work surface** from the existing authorized LiOS engines, evidence, Artifacts and Workbench. Every surface remains an explicit, typed rendering of approved LiOS state—not untrusted executable JSX, a second agent backend or an independent persistence system.

Four original composable experiences:

1. **Intent Lens — task-shaped interface.** Ordinary question → calm Chat answer. Comparative request → side-by-side comparison with source labels and adjustable criteria. Research → progressive evidence digest with conflicts. Build a financial model → relevant versioned Artifact with scenario inputs. Make a report → editable canonical document. Monitoring → opt-in change review. The user can always collapse the Lens or expand the *original* Workbench; no extra product navigation.
2. **Evidence Prism — provenance travels with interaction.** An important number or claim reveals observed period, units, source rights, deterministic vs inferred nature, assumptions, conflicts and responsible engine on demand. No decorative confidence meter, unsupported "verified" badge or automatic source wall. Model recalculations retain the source and version identity.
3. **Continuity Thread — work follows the user.** A compact work-object ribbon links exact Chat turn, active source selection, selected entity, canonical Artifact ID/version, Workbench view and approved next action. Changing a WACC/input emits a new version and makes "What changed?" inspectable back in Chat. No duplicate write store.
4. **Safe Generative Surface — real components, not arbitrary frontend code.** A bounded allowlist of typed presentation schemas for comparison, metric, evidence, data-gap, chart and Artifact preview. A model may *propose* a schema, but the LiOS server supplies permission-checked data and LiOS controls all events/mutations. Dynamic UI is denied unless schemas, permissions, source custody and render budgets pass. Fallback is the normal Chat answer.

These are **proposals for integration under existing TC/P2/P4/P5/GM/CA ownership**, not new architectural authorities. The first pilot is deterministic (no model-generated code).

## 2. New candidates located outside the recorded donor catalog

Checked against the current main donor catalog, secondary watchlist and universal donor adoption register: none of the exact names below occur in those files at this discovery checkpoint. Presence below is a **discovery proposal, not an import authorization, fork requirement or user-accessible feature**. License indications derive from linked upstream repo/docs viewed on 2026-10-23; verify license and source path at the exact selected upstream commit before reuse, including commercial addons, media and transitive packages.

| Priority | Candidate / upstream | UX leverage for LiOS | Licensing evidence & posture | Recommendation |
|---|---|---|---|---|
| P0 | [Kibo UI](https://github.com/shadcnblocks/kibo) / [docs](https://www.kibo-ui.com/docs) | Coherent source-level Dropzone, Tree, Kanban, Gantt, AI Input and status controls; especially WS-19, 17, 55 | Site describes MIT; verify selected paths and package extras | **Trial 1:** replace weak attachment presentation without replacing upload authority |
| P0 | [Tremor](https://github.com/tremorlabs/tremor) | Substantial copyable analytical card/chart/filter/dashboard patterns for workbenches, not just individual CSS | Apache-2.0 per official repo | **Trial 2:** read-only evidence-led decision snapshot with existing P4 data |
| P0 | [json-render](https://github.com/vercel-labs/json-render) | Schema-constrained catalog of predefined UIs and actions; React renderer and shadcn components | Apache-2.0 per upstream; verify each package | **Trial 3:** Safe Generative Surface prototype, read-only first |
| P0 | [CopilotKit / AG-UI](https://github.com/CopilotKit/CopilotKit) | User-in-the-loop agent widgets, task state and agent-to-UI interaction protocol; compare interaction contract | MIT repo per upstream; inspect SDK and protocol subpackages | Prototype **UI/adapter mechanics** only; preserve LiOS runtime |
| P1 | [Motion Primitives](https://github.com/ibelick/motion-primitives) | Composable motion primitives for details, disclosure and transition polish | MIT per upstream LICENSE | Adopt only restrained accessible microinteractions, not glossy system-wide animation |
| P1 | [Kokonut UI](https://github.com/kokonut-labs/kokonutui) | Finished shadcn/Tailwind UI compositions and visual polish patterns | MIT per upstream | Compare against existing Radix/shadcn controls before importing |
| P1 | [Magic UI](https://github.com/magicuidesign/magicui) | Premium animated components for rare entry moments and meaningful emphasis | MIT source; check component asset rights separately | Limit to entry/empty-state accents, reduced motion required |
| P1 | [Excalidraw](https://github.com/excalidraw/excalidraw) | Whole embeddable canvas for research mapping, assumptions/decision diagrams and collaborative sketching | MIT main project; verify integration dependencies and exports | Optional Workbench Artifact type; never replace professional document/editor |
| P1 | [Base UI](https://github.com/mui/base-ui) | Accessible unstyled primitives for complex keyboard/assistive tech interaction | MIT | Compare to in-tree Radix; only use where a real gap warrants it |
| P1 | [shadcndashboard](https://github.com/shadcndashboard/shadcndashboard) | Cohesive open dashboard, forms, table and authentication flows | MIT reported; check additional attribution in selected distribution | Reuse analytical visual blocks only; do not replace LiOS shell or auth |
| Explore | [Tambo](https://github.com/tambo-ai/tambo) | Typed interactive/generative components and streamed props | Mixed MIT + Apache-2.0 workspaces; Tambo Cloud says it **shuts 2026-10-31**, self-host possible | Inspect ideas/OSS source; **do not depend on Tambo Cloud** or adopt a second backend |
| Explore | [AI Elements](https://github.com/vercel/ai-elements) | AI-native code, source, message, task and Artifact patterns | Repo announces migration to shadcn/ui and **deprecation at end of Nov 2026**; check new distribution rights | Monitor successor; avoid new dependency on deprecated packaging |
| Restricted | [coss ui / formerly Origin UI](https://github.com/cosscom/ui) | Very large collection of high-quality controls and compositional UX | **Mixed license:** default AGPL-3.0; ONLY apps/origin and apps/ui identified as MIT | Inspect exact path; never treat whole monorepo as permissively reusable |
| Restricted | [React Bits](https://github.com/DavidHDev/react-bits) | Rich animated graphics and distinctive interactions | **MIT + Commons Clause**, not unrestricted MIT; no resale/sublicense of components themselves | No wholesale copy for resellable component distribution; legal/product-use review first |
| Restricted | [Animate UI](https://github.com/imskyleen/animate-ui) | Animated Radix/Base UI/React Aria primitives | Current repo **MIT + Commons Clause**; not vanilla MIT | Require path/version license review; prefer MIT Motion Primitives for pilot |
| Defer | [MUI Toolpad Core](https://github.com/mui/toolpad) | Finished dashboards/CRUD; potentially useful pattern study | MIT core but **not actively maintained** | Avoid core dependency; use pattern inspiration only |

**Already integrated / excluded from the "new discovery" count:** shadcn/Radix, Tiptap, Dockview, ECharts, Univer; assistant-ui already in canonical donor catalog. Do not import another copy.

## 3. Concrete combinations that create new LiOS user value

### A. Research-to-Decision Lens — first differentiating experience

**User intent:** "Compare Apple, Microsoft and Alphabet's valuation and show me the main risk."

- Existing Chat responds in human language and starts authorized work.
- Lens presents a **typed comparison board** (Tremor-like composition) with observed periods, source reference tags, actual values and an *Unknown* state when a source cannot provide a field.
- A claim selection opens **Evidence Prism** backed by canonical source/trust records; citations and source rights are not generated by the UI.
- A relevant saved Artifact opens in existing P4 sidecar; **Expand Workbench** uses existing Dockview and exact Artifact ID/version.
- User changes a scenario input; the existing engine recalculates and saves reviewed version; Chat shows "What changed?" and preserves provenance.
- Optional user-directed "Monitor this" proposes a bounded task; never silently schedules a background monitor.

**Reuse:** Tremor cards; Kibo controls if useful; existing P4/Tiptap/Dockview; optional later json-render presentation *only after* source/policy gates.

### B. File-to-Insight Lens — first practical source-import pilot

**User intent:** "Analyze this earnings PDF and compare against last quarter."

- Reuse Kibo Dropzone/tree UI where its coherent component suits current Quick Chat attachment handling.
- Existing #100/P12 upload and virus/type/size/tenant/source policies remain authoritative.
- Show upload progress, selected files, retained source identities, errors and removal with no false persistence.
- Once parsed by approved P2/P3 tools, render a document-to-evidence comparison using source-backed P4/Chat components.
- Do not create a shadow file store or auto-create a Project.

### C. Live Working Artifact Lens — editing with trust

**User intent:** "Change WACC to 9% and show the upside impact."

- Prefer typed assumption controls using current P4 Artifact/engine methods.
- Show original vs reviewed assumptions, units, revised version and deterministic effect.
- If missing data/permission, show actionable gap—not an editable fake.
- "Why did this change?" opens provenance/methodology.
- User may open complete Workbench or return to Chat; same object and version.

### D. Agent Action Lens — UI visible only at the decision point

**User intent:** "Prepare my board report and send it."

- Drafting may happen within granted scope; external sending becomes a visible reviewable action.
- Compact summary of target/destination/sensitivity/cost/risk plus **approve / deny** tied to real LiOS approval object.
- CopilotKit AG-UI supplies ideas for stateful action UI, **not permission authority**.
- Never call an action complete before the canonical receipt is obtained.

## 4. Reuse selection: measurable gates, not a popularity contest

Score each candidate 0–5 against (a) real user journey gap 25%, (b) coherent reusable component/subsystem quality 20%, (c) integration fit with current React/Vite/Tailwind/Radix/P4 20%, (d) accessibility/testability 15%, (e) maintenance/footprint 10%, (f) design differentiation 10%. **License/rights, canonical authority, privacy and security are independent pass/fail gates, not weighted points.**

Avoid importing a whole site simply because it looks attractive. For each selected component/package: verify exact upstream SHA, file paths, exact path-level license, source/asset notices, imports, peer deps, browser/Electron packaging, accessibility and build impact; retain source-path disposition; import upstream tests; run LiOS tests; add installed interactions; gate with source checks and review. Track *reuse vs rebuilt effort* and *user-journey improvement*.

## 5. Ordered proof-of-value experiments, tied to existing 65 workstreams

| Trial | Mapped workstreams | Scope and success criterion | Stop condition |
|---|---|---|---|
| **1. Real-file upload Lens** | WS-19, WS-22, WS-25 | Inspect #100; import/adapt usable Kibo Dropzone & Tree source in existing Chat only if faster and more accessible. Same canonical upload, retry, privacy and temporary-state behavior. | Would create second upload store, fail Electron, or require blocked license. |
| **2. Evidence-led comparison Lens** | WS-26–31, WS-34, WS-39, WS-46–49 | Reuse Tremor compositional widgets to make a P4-backed comparison Artifact with source/uncertainty handles. No invented finance numbers. | Cannot bind to real governed Artifact/source data. |
| **3. Safe schema-driven Lens** | WS-15, WS-26, WS-34, WS-43 | Spike json-render typed read-only component catalog and compare with current LiOS renderer. Data/actions are server-authorized; verify fallback and accessibility. | Any untrusted JSX/HTML execution, parallel store/permissions, or invalid source claims. |
| **4. Action review Lens** | WS-50–53, WS-63 | Adapt CopilotKit interaction patterns for existing governed review receipts, offline/deny/cancel states. | External/unsafe action bypasses canonical approval. |
| **5. Signature visual polish** | WS-06–12, WS-58–62 | Pilot Motion Primitives/Kokonut in ONE high-value view; test contrast, reduced-motion, startup and no layout shift. | Decorative motion reduces comprehension or installed responsiveness. |

**Immediate execution order:** first recheck outstanding #100/#102/#115 and newest UX changes; pilot Kibo file UI through existing P12 owner; in parallel conduct an evidence-only json-render safety/size proof, then propose the first real adaptive Lens only after acceptance. Do not merge an attractive but fake prototype as a shipping feature.

## 6. Minimum acceptance demonstrations

1. A first-time user asks a general question: normal quiet Chat, no irrelevant dashboard or AI gimmicks.
2. Compare three companies: authorized data becomes an interactive, source-backed comparison; missing values remain unknown.
3. Open one comparison as the *same* P4 Artifact, edit a material assumption, return from Workbench, reopen exact revision.
4. Attach an earnings PDF; inspect upload policy, errors, data provenance, and answer without mandatory Project.
5. A consequential agent action requires review; denying leaves no external side effect.
6. Narrow-window, keyboard, VoiceOver/Narrator, privacy consent, stale grant, provider failure and restart have truthful behavior.
7. All code reuse passes project donor-license, provenance, upstream tests and source/installed target checks.

**Decision:** treat UI donor hunting as a creative **capability and experience composition program**, not a checklist to fork more projects. LiOS's innovation must come from *when and why it reveals the right interactive view* while preserving its real intelligence, evidence and work state.
