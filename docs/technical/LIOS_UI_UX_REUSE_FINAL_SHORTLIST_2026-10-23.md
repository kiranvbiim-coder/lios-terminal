# LIOS UI/UX — Consolidated Open-Source Reuse Shortlist

**Reviewed:** 2026-10-23. **Status:** technical sourcing and reuse decisions, **not** blanket import approval or feature-shipped evidence.  
**Authority:** \`docs/LIOS_UX_SYSTEM.md\`, \`docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md\`, \`docs/ux/LIOS_ADAPTIVE_EXPERIENCE_EXECUTION_PLAN_2026-10-23.md\`, original 206 SI items / mapped 65 UX WS, issue #91.  
**Catalog role:** **One prioritized selection list** for UI/UX workstreams. The earlier Innovation Lab is the evidence/discovery annex; this file is the current preferred source-selection map. This does **not** replace the existing 92-donor register and does not claim the sources have all been imported.

## Decision in one sentence

**Keep the existing LIOS React 18/Vite/Tailwind 3/shadcn-Radix foundation, canonical Chat/P4 Artifacts and Dockview Workbench; selectively copy mature MIT/Apache interaction components; make LIOS different by assembling typed, evidence-backed *Adaptive Intelligence Lenses* from its own authorized work objects.**

Do not install Material UI, Chakra UI and HeroUI all as global component systems; do not upgrade React/Zod/Tailwind simply to add one appealing visual component.

## 1. Existing LIOS foundations — reuse, improve, do not replace

| Built-in authority | What LIOS already uses | Decision |
|---|---|---|
| **shadcn-style components / Radix** | Buttons, dialogs, menus, popovers, forms, shared primitive components | **Primary UI primitives.** Reuse in-tree components first; keep LIOS dark graphite/gold tokens. |
| **Dockview** | Professional Workbench docking and panel layout | Keep one workspace and canonical layout persistence; no second workstation. |
| **Tiptap** | Rich professional Artifact editing | Enhance existing P4 editor; exclude paid Tiptap add-ons without explicit rights. |
| **Univer** | Spreadsheet and tabular Artifact editor | Preserve sheet formula/model state and real numerical engines. |
| **Apache ECharts** | Charts and analytical visualizations | Preserve real datasets, periods, units, chart/event integrations. |
| **LIOS Chat/P4/P2/P3/P5/P9** | Runtime, provenance, evidence, ownership, source rights, approvals | UI donor components must consume these; they do not become data, execution, permission or file authorities. |

As inspected from \`src/package.json\` on \`main\`: React \`^18.3.1\`, React DOM \`^18.3.1\`, Tailwind \`^3.4.17\`, Zod \`^3.24.2\`, Radix, Dockview \`8.3.1\` and Tiptap \`3.31.4\`. The main package **does not include** \`@mui/material\`, \`@chakra-ui/react\` or \`@heroui/react\`.

## 2. Final list — 26 external UI/UX projects screened

Legend: **ADOPT** = good source-level candidates on a confirmed workstream; **COMPARE** = evaluate only if existing LIOS fails the journey; **DEFER** = framework/maintenance mismatch; **RESTRICT** = special rights issues, do not import without exact-source legal/provenance review. **ADOPT** never means automatic license clearance, installed/merged state or an obligation to install an entire library.

### Primary source-level selection (9)

| Rank | Source | Best LIOS usage / WS mapping | Compatibility and decision |
|---|---|---|---|
| **1** | [Opensource UI](https://github.com/bidyut10/opensourceui) / [catalog](https://opensourceui.in/components) | Search inputs, file/drop interaction, filters, table/status controls, keyboard-friendly copy/actions; **WS-09, 17, 19, 28, 52** | **ADOPT**, exact compatible component sources (repo MIT). Its *website app* uses Next16/React19/Tailwind4: do not import the app. **First real partial implementation: PR #122**, MIT SearchInput adaptation within canonical Chat Source Registry; stacked on #100, not merged. Pin \`892f486fdf0d46a44b21ddf3fa32a41a3a71173a\`; path-level notice under #122. |
| **2** | [Uiverse](https://uiverse.io/) / [Galaxy source](https://github.com/uiverse-io/galaxy) | Small premium microinteractions: CSS-only loaders, input states, toggles, confirmation, tooltip, progress, affordance; **WS-06, 09–12, 22, 60–62** | **ADOPT selective CSS/source**, Galaxy MIT; pin exact selected file/creator, notice and asset provenance. Community quality varies. Avoid visually noisy animation, misleading progress, accessibility regressions and perf overhead. Prefer Galaxy source with explicit MIT coverage rather than unattributed website snippets. |
| **3** | [Kibo UI](https://github.com/shadcnblocks/kibo) | Coherent Dropzone, file tree, Kanban/Gantt and advanced app controls; **WS-19, 55** | **ADOPT after need verified**. MIT reported/reviewed at \`3d63cdb15b79d972e3dc38a10997987672f9b263\`; Dropzone uses \`react-dropzone\`. Test React18 and existing #100 upload/temp/permission semantics. Do not import a second uploader. |
| **4** | [Tremor](https://github.com/tremorlabs/tremor) | Professional metric/comparison cards, source-led analysis, filters; **WS-30, 39, 46–49** | **ADOPT compositions selectively** (upstream Apache-2.0). Keep ECharts and P4 authoritative; do not import demo numbers or entire admin/dashboard shell. |
| **5** | [assistant-ui](https://github.com/assistant-ui/assistant-ui) | Message, composer, streaming and thread interactions; **WS-15, 18, 22–24** | **COMPARE, then adopt source-compatible interactions** only. Already present in earlier donor catalog. Avoid second Chat runtime/thread store. Package version/deps and Zod mismatch require exact-source check. |
| **6** | [TanStack Table](https://github.com/TanStack/table) | Headless professional table mechanics, sorting/filtering/pagination/selection; **WS-38–39, 46–49** | **COMPARE/ADOPT on actual gap** (MIT source). Prefer headless state under existing P4 data governance; not a second spreadsheet or calculation authority. |
| **7** | [React Flow / xyflow](https://github.com/xyflow/xyflow) | Optional workflow and agent graph canvas; **WS-50, 55** | **COMPARE** (MIT core); avoid replacing Dockview or creating second agent executor. |
| **8** | [CopilotKit / AG-UI](https://github.com/CopilotKit/CopilotKit) | Human-in-the-loop action review and observable agent state; **WS-50–51** | **COMPARE interaction/protocol only**; check selected MIT package/license; canonical P2/GM execution and approvals stay in LIOS. |
| **9** | [Excalidraw](https://github.com/excalidraw/excalidraw) | Optional complete sketch/mapping Artifact in Workbench; **WS-34, 43–45** | **COMPARE** (MIT core); requires actual user journey and full payload/assets/export rights review, not mandatory first-use chrome. |

### Useful secondary comparisons / conditional source reuse (8)

| Rank | Source | LIOS fit | Decision |
|---|---|---|---|
| 10 | [Motion Primitives](https://github.com/ibelick/motion-primitives) | Focus/disclosure, subtle transitions | **COMPARE / selective adoption** MIT, a11y and reduced motion first; WS-11 |
| 11 | [Kokonut UI](https://github.com/kokonut-labs/kokonutui) | Polished shadcn-like compositions | **COMPARE** MIT source/path/asset audit; WS-09 |
| 12 | [Magic UI](https://github.com/magicuidesign/magicui) | Selective first-use visual emphasis | **COMPARE** MIT source; avoid expensive visual effects; WS-12–14 |
| 13 | [Base UI](https://github.com/mui/base-ui) | Accessible primitive behavior | **COMPARE** MIT, only if Radix actually fails a need; WS-09, 58 |
| 14 | [shadcndashboard](https://github.com/shadcndashboard/shadcndashboard) | Professional dashboard examples, analytics layouts | **COMPARE** exact distribution/asset rights; no second global shell; WS-39, 44 |
| 15 | [LibreChat](https://github.com/danny-avila/LibreChat) | Mature Chat navigation/attachment/agent UX patterns | **COMPARE** carefully licensed code; never replace LIOS Chat runtime or storage; WS-15–25 |
| 16 | [Material UI](https://github.com/mui/material-ui) / [MUI X](https://mui.com/x/) | Advanced tables, pickers, complex accessibility/forms; **WS-09, 38, 44, 52** | **COMPARE only**, not a global LIOS provider. \`@mui/material\` core is **MIT**, current stable major **v9** (current master development package is **v10 alpha**, not stable). React17/18/19 peer accepted, but Emotion runtime and React18 \`react-is\` override needed; MUI X *Pro/Premium* commercially licensed, Community MIT. Prefer existing Radix/headless before package installation. |
| 17 | [Chakra UI](https://github.com/chakra-ui/chakra-ui) | Accessible forms, validation, dialog, tokens/recipes; **WS-09–10, 52, 58** | **COMPARE only**, do not adopt another root theme/provider without reason. \`@chakra-ui/react\` v3.37.0 **MIT**, React **>=18**; requires Emotion and ChakraProvider/theme system. Compatible with LIOS React18 but duplicates Radix/shadcn design authority. |

### Deferred due to framework / product / maintenance mismatch (5)

| Rank | Source | Blocker and future disposition |
|---|---|---|
| 18 | [HeroUI](https://github.com/heroui-inc/heroui) | **DEFER direct v3 import**. v3 \`@heroui/react\` **3.2.6** peer React **>=19**, Tailwind **>=4**; LIOS React18/TW3. v3 React package declares **MIT** while repo root LICENSE is **Apache-2.0**: check exact path/package, not a blanket claim. v2 is separately versioned and its current docs also specify Tailwind4; no assumed drop-in on LIOS. Use as design reference; revisit after separately approved frontend upgrade. |
| 19 | [json-render](https://github.com/vercel-labs/json-render) | **DEFER package**, adapt *typed schema/allowlist design* within existing LIOS renderer. v0.21.1 React19 and Zod4, Tailwind4 for shadcn package; React18/Zod3/TW3 LIOS today. |
| 20 | [Tambo](https://github.com/tambo-ai/tambo) | **DEFER** cloud integration; hosted Tambo Cloud announced shutdown **2026-10-31**, mixed package licenses; use conceptual UI research only and avoid second backend. |
| 21 | [AI Elements](https://github.com/vercel/ai-elements) | **DEFER legacy package** due to announced shadcn migration/deprecation end Nov 2026; compare successor once stable and licensed. |
| 22 | [MUI Toolpad Core](https://github.com/mui/toolpad) | **DEFER** due to not-actively-maintained status; borrow layout ideas only, avoid core runtime. |

### Restricted/mixed-rights (4)

| Rank | Source | Reason |
|---|---|---|
| 23 | [coss UI / Origin UI](https://github.com/cosscom/ui) | **RESTRICT**: mixed AGPL-3.0 default, selected app paths MIT. Only copy specifically confirmed MIT paths with attribution; never treat all as MIT. |
| 24 | [React Bits](https://github.com/DavidHDev/react-bits) | **RESTRICT**: MIT + Commons Clause terms are not unrestricted MIT; review usage/distribution rights; do not bulk import. |
| 25 | [Animate UI](https://github.com/imskyleen/animate-ui) | **RESTRICT**: current Commons Clause additions; prefer permissively licensed motion primitives. |
| 26 | [Open WebUI](https://github.com/open-webui/open-webui) | **RESTRICT**: current v0.6.6+ has branding conditions; older BSD-3 sources differ. Not approved for wholesale white-labelled import; require exact version/path rights review. |

## 3. Four new user-supplied sources — inspected repo evidence

| Source | Verified repo/package (2026-10-23) | Legal/runtime gate |
|---|---|---|
| Uiverse Galaxy | \`uiverse-io/galaxy\`, inspected commit \`adbd2adde0a299a3956ea288fb444ec01891ca41\`; \`LICENSE\` MIT; README claims 3,000+ archive components | Safe *candidate*, not per-file audit. Preserve full MIT notice and verify specific author assets; accessibility and CSS performance per import. |
| Material UI | \`mui/material-ui\`, inspected \`04112758f61cad3b69d0e6feaa6facd699fa676d\`; root MIT; \`packages/mui-material/package.json\` on development \`master\` shows **10.0.0-alpha.0**; official versions page shows stable **v9** | React18 peer allowed with Emotion; MUI React18 docs recommend pinned \`react-is\`; MUI X is open-core Community MIT, Pro/Premium paid. No global framework addition. |
| Chakra UI | \`chakra-ui/chakra-ui\`, inspected \`960ae222ace1df8de835dc3c62d698f1b58b6786\`; \`@chakra-ui/react\` v3.37.0, MIT, React \`>=18\`, \`react-dom >=18\`, Emotion peer | Framework compatible but redundant provider/tokens/styling. Keep as fallback for missing complex forms and a11y rather than install by default. |
| HeroUI | \`heroui-inc/heroui\`, inspected v3 branch \`d814c204a92464ca02eb229c384a4a982d1ab398\`; \`@heroui/react\` v3.2.6 MIT; root \`LICENSE\` Apache-2.0 | Peer requires React19+, Tailwind4+; **not current LIOS compatible**. Verify package/root license precisely before any future import. |

Official docs and inspectable source evidence:
- Uiverse [Galaxy README](https://github.com/uiverse-io/galaxy#licensing-and-attribution) and [LICENSE](https://github.com/uiverse-io/galaxy/blob/main/LICENSE)
- Material UI [installation & React18 special case](https://mui.com/material-ui/getting-started/installation/), [supported stable versions](https://mui.com/material-ui/getting-started/versions/), [MUI X open-core licensing](https://mui.com/x/introduction/licensing/)
- Chakra [current installation](https://chakra-ui.com/docs/get-started/installation) and [package](https://github.com/chakra-ui/chakra-ui/blob/main/packages/react/package.json)
- HeroUI [v3 requirements](https://heroui.com/en/docs/react/getting-started/quick-start) and [v3 package](https://github.com/heroui-inc/heroui/blob/v3/packages/react/package.json)

## 4. What to actually import, by highest-value experience

| Sequence | User-visible experience | Primary reuse | Existing LIOS seam | Acceptance |
|---|---|---|---|---|
| **A. Already coded, PR not shipped** | Search Chat Source Registry | Opensource UI SearchInput | P1 \`ChatSourcesControl\`, same \`/api/setup/source-registry\`; [#122](https://github.com/kiranvbiim-coder/lios-terminal/pull/122), stacked on [#100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100) | Real filtering, keyboard, licensing, no fake source permissions, exact-head CI and native test later |
| **B. Next UI pilot** | Quiet Chat loading, permission/failed/empty and Stop feedback | One Uiverse MIT Galaxy loader/feedback composition, if better than in-tree control | \`ConversationRuntimeTrace\` + existing state/event semantics, WS-10/11/22 | No invented percentage/time; dark design, reduced-motion, focus and no unnecessary animation |
| **C. Flagship Lens** | Research → evidence-led side-by-side comparison → P4 Artifact | Existing P4/ECharts, selective Tremor card/table composition | P3/P5/P4 evidence, version and source rights; WS-26–31,34,39,43–49 | Real entitled values or explicit Unknown, source/period/currency labels, keyboard table alternative |
| **D. Input/attachment polish** | Compact drag/drop, file list, failed upload recovery | Compare Kibo Dropzone vs Opensource UI FileUploadFieldInput; **choose one**, if better than #100 | Canonical Quick/Project/Temporary attachment owner; WS-19/25 | 5-file/size/type rules, Temporary nonpersistence, reconnect and server policies unchanged |
| **E. Professional forms** | Data Connection Center + model assumption editing | Existing Radix/shadcn first; Chakra/MUI **interaction study** only | Canonical P4/connector permissions and controlled inputs; WS-37/47/52/58 | Accessible dialogs; no parallel Chakra/MUI Provider or invalid model mutation |
| **F. Agents and Workbench** | Consent-bound action review, evidence/progress, optional flow map | CopilotKit/AG-UI state patterns; optional xyflow/Excalidraw later | Existing P2/GM approvals and Dockview, WS-43/50/51/55 | Approval receipt, denial, cancellation, no unauthorized external action |

**Specific rule for Uiverse:** choose one restrained element whose behavior solves a real defect, copy *only* that element's audited MIT HTML/CSS or React adaptation, strip unnecessary animations and global selectors, preserve the creator/source notice and test contrast/keyboard/reduced-motion/native performance. Do not bulk-paste 3,000 effects.

## 5. Import policy and source-of-truth rules

1. Confirm **actual LIOS missing behavior** from source and active PRs; prefer existing components and correct existing state bugs before adding dependencies.
2. Identify a **specific upstream source file and commit**, license plus bundled SVGs/fonts/photos/icons, third-party runtime/deps and target React/Tailwind/Electron compatibility. “Website free” is not a replacement for path-level licensing.
3. Reuse a coherent working source component where advantageous; **retain LIOS** state, rights, data, ownership, translations, design tokens and API boundaries. Avoid independent authentication/provider/file/Artifact systems.
4. Import full notices/provenance with adopted/modified/excluded path decisions, upstream tests, LIOS keyboard/accessibility/visual/permission/error tests, and precise PR ownership. **No framework-wide import by default.**
5. Pass required exact-head Linux/macOS/Windows source checks and review, then validate installed journeys. A donor being discovered, forked, merged or import-tested is *not* accepted UX.
6. Only revisit a competing framework after a separately approved whole-stack design-system/framework migration with measured user benefit, size/performance and rollback.
7. Track execution in **issue #91 and canonical PENDING_WORK**; innovation doc and this shortlist are supporting selection evidence, not new SI scope.

**Bottom line:** *shadcn/Radix remains core; Opensource UI and Uiverse are practical first-copy libraries; Tremor is the first analytical layout donor; Kibo is the file UX alternative; MUI/Chakra are reserve tools; HeroUI/json-render await framework fit; restrictive licenses are not casually imported.* The moat is the LiOS Evidence Prism + Adaptive Lens + exact Artifact/Workbench continuity, not the quantity of installed UI libraries.

---

## 6. User-submitted 20-site design/tool sweep — 2026-10-27 (supplement, not imports)

**Purpose:** Triage the 20 submitted URLs within the *existing* 26-source UI shortlist, the 92-donor canonical registry and current SI-07/TC, GM, P4, P13 owners. This is an additive **source-selection note**, not a new donor registry, plan, implemented feature or release claim. No site contents, copyrighted icon/logo, font, template, screenshot, source package, credential or paid service was copied/installed by this sweep. Current \`main\` and unmerged #227/#231/#249/#257/#260 must be reconciled before shipping any subsequent design/code changes.

**Rules:** “Free to browse”, “free template”, “copy prompt”, “free trial” and “open-source MIT” mean different things. Marketing/media references do not authorize embedding source or art assets in the LiOS desktop app. LiOS has an owner-locked **$0 additional release spend**, so vendor usage charges, Pro licenses and new subscription/hosting dependencies are not approved. The secure, user-owned app retains all canonical data/permission/Artifact/Chat authorities; animations must honor reduced motion, focus, contrast, Electron CSP, startup weight and low-memory operation.

| # | Website / verified use | LiOS-specific decision | Actual source/import disposition |
|---|---|---|---|
| 1 | [Modulify](https://modulify.ai/) — hosted AI web-app/site builder | **REFERENCE** for prompt→preview feedback and responsive landing-page polish; no competing LiOS site builder, CMS or hosting | External commercial platform, **not imported**. Free plan has limited credits; do not claim cheaper than another builder without comparable pricing. |
| 2 | [Modulify templates](https://modulify.ai/templates) — builder-clonable page examples | **REFERENCE** marketing/entry layouts; “clone” is into the Modulify workspace, not permission to copy assets/source into LiOS | **Not imported**; independent template/asset rights must be checked. |
| 3 | [Landdding](https://landdding.com/) — curated landing pages | **REFERENCE** visual hierarchy for the existing public product preview and authorized entry flow | Gallery, not donor runtime; **no import**. |
| 4 | [Motion](https://motionin.design/) — interactive section/prompt gallery | **REFERENCE/VERIFY ACCESS** for a restrained hero motion prototype, not whole-site generation or raw code | Direct site did not load in audit; independent page reports copyable prompts and premium entries. **No licensed source established**. |
| 5 | [Iconly](https://iconly.design/) — app icon inspiration | **REFERENCE** scale/grid/stroke treatments; retain the existing licensed icon family and LiOS brand | **Do not copy third-party app icons/trademarks**. |
| 6 | [Font In Logo](https://fontinlogo.com/) — brands' typeface lookup | **REFERENCE** typographic analysis only; use current legal system/design font stack | Typeface identification is **not a font redistribution license**. |
| 7 | [on.design](https://on.design/) — designer/community product | **REFERENCE / ACCESS GATED**; accessible endpoint redirects to login | No public source or transferable designs verified. |
| 8 | [Godly](https://godly.website/) — former curated design gallery | **DEDUP** into #11 (Recent); no separate implementation task | Now represented by Recent; **not an extra donor**. |
| 9 | [60fps](https://60fps.design/) — UI animation references and snippets | **HIGH-PRIORITY BENCHMARK** for motion in Chat/Live/Work; evaluate accessibility/reduced motion before source use | Inspiration/snippet rights checked per item; **not imported**. |
| 10 | [Footer Design](https://footer.design/) — footer gallery | **REFERENCE** for public preview / marketing website only, not persistent workbench chrome | **No import**. |
| 11 | [Recent](https://recent.design/) — curated web, interaction, brand and motion references | **HIGH-PRIORITY BENCHMARK** for restraint/visual identity; covers #8 | Gallery/reference only; **no imported runtime**. |
| 12 | [Backgrounds Supply](https://backgrounds.supply/) — backgrounds and paid/free assets | **CONDITIONAL REFERENCE** for a very light entry/empty-state background, subject to rights, accessibility, size and no-motion fallback | Assets **not imported**; explicit license/asset identity required. |
| 13 | [Posts Design](https://posts.design/) — social brand post/OG image gallery | **REFERENCE** for separate marketing materials / public preview social cards, not private user-work promotion | **No import**; avoid copying other brands' artwork. |
| 14 | [beUI](https://beui.dev/) / [MIT upstream](https://github.com/starc007/ui-components) — copyable React motion components | **ONLY DIRECT OSS SOURCE CANDIDATE IN THIS SUBMITTED SET FOR A FIRST PILOT**: choose one bounded status/progress or approved-action visual component after comparing existing Radix/shadcn/UX and source-level compatibility | Upstream \`starc007/ui-components\` MIT \`LICENSE\` inspected at \`41a330ba66684696c445d58ca5d77c0133d4059a\` (2026-10-26). Upstream site uses React 19/Tailwind 4; **LiOS React 18/Tailwind 3 compatibility not proven**. No beUI code/package imported, no Pro assets licensed. |
| 15 | [Wonderlist](https://wonderlist.design/) — 127 premium Figma designs | **REFERENCE/PAID**, not a free-source library | Paid design collection; **no licensed acquisition/import**. |
| 16 | [Mobbin](https://mobbin.com/) — real application flow/screens | **HIGH-PRIORITY BENCHMARK** for onboarding, sources, projects, responsive navigation | Screenshots/research are not source licenses; **no import**. |
| 17 | [Sent](https://sent.dm/) — SMS, WhatsApp and RCS API | **DEFER external connector**: only user-directed outbound messaging with consent/entitlement, approval, delivery receipts and budget control under P13/GM; no hosted LiOS dependency | Vendor's current pricing is usage-based (example \`$0.015/contact/month\` plus messages). Incompatible with assuming zero-cost bulk messaging; **not integrated**. |
| 18 | [Closeit.fast](https://closeit.fast/) — external document e-signing | **DEFER optional, user-authorized external service**. Future P4→P13 signed-document handoff only with consent, document/privacy/provenance rules and returned signature receipt | Proprietary service; **no source/import/API entitlement verified**. |
| 19 | [Paper Animation](https://paperanimation.ai/) — browser-based short-form motion exports | **REFERENCE** for separately created marketing videos; never make desktop runtime dependent on it | Free exports watermarked; paid clean exports; **no core import**. |
| 20 | [HorizonX.si](https://horizonx.si/) — submitted without an identifiable description | **UNVERIFIED**: direct endpoint inaccessible in this audit, so no conjectured feature | **No import or paid commitment** pending reliable official description/source. |

### Implementation queue inside existing owners (not an additional phase)

1. **Do not redo existing work.** Reconcile Phase #227–#257, UI polish #221–#223 and source-donor audit #260. Inspect the actual current Chat/Live/Workbench status or approval affordance, not a design mock. A website listed here is never proof of adoption.
2. **First eligible new implementation experiment:** inspect a *single* beUI MIT component source at the pinned SHA **only after finding an unmet LiOS interaction**. Evaluate a compact truthful pending→approved/denied/cancelled status treatment inside the incumbent governed-action UI (P2/GM), or a small reduced-motion-safe Live status, whichever demonstrates the measurable gap. **Do not import** an entire React19/Tailwind4 framework, a second chat approval authority, a global Motion dependency for decoration, Pro files or redundant navigation.
3. Compare that candidate against the already-screened MIT Motion Primitives/Uiverse/Kibo and **existing LiOS components**. An upstream component that fails React18/Tailwind3 fit or increases bundle cost without a visible clarity/accessibility gain is deferred rather than fabricated.
4. Before a real import: record upstream commit/path/rights/NOTICE + exact dependencies, current owner and consumer, keyboard/screen-reader/390px/200%-zoom/reduced-motion/low-power tests, CSP/offline/installed Mac+Windows checks, and same state transitions with successful/failed/rejected/cancelled operations. Include a no-animation fallback and clear provider/user consent for any external action.
5. Use 60fps, Mobbin and Recent **only as visual interaction benchmarks** for the existing UX acceptance checklist. The public website / separate marketing materials may consult Modulify templates, Landdding, Footer, Posts and Paper Animation without turning them into desktop runtime dependencies. Do not introduce ads that profile conversation or finance data.
6. Revisit paid/hosted Sent or signing integrations **only** as explicitly user-funded, consented, governed connectors under their existing owners, not as automatic platform features. Current $0 release work does not purchase subscriptions, send campaigns or sign documents.

**Observed source checks:** [beUI MIT repository](https://github.com/starc007/ui-components), [official free Modulify templates](https://modulify.ai/templates), [60fps collection](https://60fps.design), [Recent](https://recent.design), [Mobbin](https://mobbin.com), [Sent pricing](https://www.sent.dm/pricing), [Paper Animation terms](https://paperanimation.ai). Site availability and commercial terms may change; re-verify before committing dependencies or user-facing promises.

**Truth after this sweep:** 20 submissions considered, **not 20 packages**; #8/#11 are one current gallery, #1/#2 one platform with a separate template page. Exactly one verified permissively licensed **new web component source candidate** was identified in this set (beUI), but **zero new imported components/services, zero runtime acceptance and zero releases** are claimed in this PR.
