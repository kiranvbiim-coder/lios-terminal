# SI-05 controlled fork adoption — evidence-backed execution

**As-of:** 2026-10-11. **Owner:** SI-05 / P11 + GM-12/P7 as applicable. **Shipping target:** SP-05 Financial Intelligence Alpha. **Authority:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `docs/technical/LIOS_FINANCE_INTELLIGENCE_TO_ACTION_BLUEPRINT.md`, `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`. **Machine-readable audit:** `third_party/controlled-fork-utilization.json`.

## What the GitHub forks actually do today

The authenticated owner's 10 controlled mirrors were verified against their GitHub parent repositories and observed default-branch SHA. They are **inspection/patching/experiment sources**, not automatic dependency pins or runnable LiOS capabilities. The baseline 92 donors remains unchanged. Status below means *recorded current-main integration truth*, not the presence or absence of any analogous LiOS-native capability.

| Controlled fork (user-owned) | Original upstream | Current proof | SI-05 role / disposition |
| --- | --- | --- | --- |
| [openclaw](https://github.com/kiranvbiim-coder/openclaw) | openclaw/openclaw | **Partially integrated** via independently approved upstream pin `c074824a`, imported path mapping and MIT notices in `third_party/components.json`. Fork HEAD is **not** that pin. | Already-used GM-10/GM-11/GM-12 execution, tool and approval infrastructure; reuse for governed .37 and .30, no parallel gateway |
| [cua](https://github.com/kiranvbiim-coder/cua) | trycua/cua | Mirror observed; not a baseline import claim | .30 controlled-computer workflow challenger; keep GM-14/local user-grant authority |
| [TradingAgents](https://github.com/kiranvbiim-coder/TradingAgents) | TauricResearch/TradingAgents | **Documented only**; approved upstream pin in `upstream-lock.json`, no imported paths claimed | First SI-05 agent-research challenger for .26/.27/.29; remove autonomous broker execution |
| [FinRobot](https://github.com/kiranvbiim-coder/FinRobot) | AI4Finance-Foundation/FinRobot | Mirror observed, not in baseline 92 | .34 banking/analysis reporting; verify exact import-path and dataset rights |
| [FinGPT](https://github.com/kiranvbiim-coder/FinGPT) | AI4Finance-Foundation/FinGPT | Mirror observed, not in baseline 92 | .26/.39 finance NLP/model benchmark; user-controlled model weights, dataset rights separately |
| [LangAlpha](https://github.com/kiranvbiim-coder/LangAlpha) | ginlix-ai/LangAlpha | **Documented only**; upstream pin exists, no imported paths claimed | .22/.28 research/workspace mechanism; preserve LiOS Project/Artifact tool ownership |
| [dexter-js](https://github.com/kiranvbiim-coder/dexter-js) | **rodionlim/dexter-js** | Mirror observed; **NOT** the registry's `virattt/dexter` entry | .22/.27 independently inspect exact source and rights; never borrow the other Dexter pin |
| [browser-use](https://github.com/kiranvbiim-coder/browser-use) | browser-use/browser-use | Mirror observed; no full donor runtime import evidenced | .22/.27 governed browsing challenger behind canonical GM-14, source/consent limits |
| [qlib](https://github.com/kiranvbiim-coder/qlib) | microsoft/qlib | **Documented only**; P11 candidate, not a running engine | .12/.13/.16/.23 reproducible P11 quant/forecast and portfolio-risk challenger |
| [graphrag](https://github.com/kiranvbiim-coder/graphrag) | microsoft/graphrag | Mirror observed; not a baseline import claim | .22/.31 evidence-linked graph retrieval candidate, no second memory/source store |

`mirror_observed_no_runtime_claim` says **this inventory makes no runtime-import assertion**; it does not prove no other LiOS implementation of the corresponding capability exists. The authoritative status of baseline donors stays in `third_party/capability-assimilation.json`; upstream pins in `third_party/upstream-lock.json`; actual imported paths/rights in `third_party/components.json`. Never use the latest fork HEAD in place of an approved pin.

## Action order: make forks useful without creating another platform

1. **Preserve the already-active SI-05 integration stack.** PRs #541–#548 are stacked and must be reviewed/landed in dependency order (governed paper actions → actual-price basis → assumption impact → portfolio impact → truth reconciliation → SP-05 contract → model-maintenance review → corporate-action impact). Tests or branches do not constitute SP-05 owner acceptance. Don't directly wire a donor's AI/portfolio engine into these authority owners.
2. **SI-05.16/.23 — Qlib numerical challenger.** Inspect a coherent actual Qlib quant/evaluation subsystem and its required packages/data inputs; record exact source paths and license, external dataset entitlement, held-out deterministic fixtures, and point-in-time/adjustment policy. Prefer a governed P11 adapter/validator over a competing market-data/cache source. If import is approved, register real pinned paths, tests and required notices; prohibit future-data leakage and unsupported forecasts.
3. **SI-05.26/.27/.29 — TradingAgents evidence-checked research.** Inspect the coherent specialist team, tool invocation, checkpoints and output schemas at the **approved** upstream pin (do not assume fork is pinned). Integrate through GM-12 governed invocation and P5/P7 identity + evidence/permission; model opinions remain labeled inference, not observed financial facts. Reuse one canonical ledger/Artifact. No donor live broker execution.
4. **SI-05.34/.39 — FinRobot and FinGPT.** Perform path-level security/rights review, external data + model-weight rights review, dependency and footprint check. Use a first-class finance report or model-evaluation adapter only after a real permission-aware test. For models, use user-owned BYOAI/managed local runtime; don't ship opaque weights or scrape licensed data without rights.
5. **Research/computer support:** Evaluate browser-use/CUA/GraphRAG/LangAlpha/dexter-js only when the SP-05 journey requires that mechanism; wrap under GM-14/P7 and canonical LiOS state. Each import must have explicit destination paths and negative access, cancellation and restart tests.

### Definition of a *fork actually being used*

A donor counts as **actually integrated** only after a bounded PR records: canonical LiOS owner, approved upstream commit and exact imported source paths, LiOS destination paths, license/notices, material modifications/dependencies, real unit/negative tests, true runtime execution behind one LiOS authority, and downstream packaged qualification as appropriate. `controlled-fork-utilization.json` deliberately **does not** claim any of these by itself. Reuse source subsystems when valuable, not only superficial donor names or copied architecture diagrams.

### Validation

Run on an installed LiOS checkout:

```bash
node src/script/validate_controlled_fork_utilization.mjs
node --test src/script/validate_controlled_fork_utilization.test.mjs
```

The audit refuses duplicate fork IDs/repos, invalid commit snapshots, absent SI-05 workstreams, upstream/pin impersonation, unregistered forks falsely marked integrated, and invented baseline import status. It never executes a fork, downloads weights or modifies the 92-donor baseline.

**SP-05 target remains:** real entitled company/security evidence → observed change → deterministic assumption/valuation update → portfolio/risk impact → editable/cited Artifact + Decision → reviewed action/no-action → paper simulated reconciliation and receipts. No live brokerage is required; SP-01–SP-04 Foundation owner gates remain separate obligations.
