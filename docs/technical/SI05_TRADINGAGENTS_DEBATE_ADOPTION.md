# SI-05 TradingAgents research-debate adapter — bounded donor adoption

**Scope:** SI-05.26 (earnings / analyst intelligence), SI-05.27 (research opinions), SI-05.29 (disagreement). **Status: source-pinned read-only adapter registered via the canonical LiOS conversation tool catalogue on this feature PR; NOT merged/shipped, real research-source integration or SP-05 acceptance.**

## Donor provenance

- Upstream: `TauricResearch/TradingAgents`; owner's verified mirror: `kiranvbiim-coder/TradingAgents`.
- Exact approved upstream pin: `2d17df8da1536c121e4d7395ac5a5dcec9e96d6f`; **do not silently substitute fork HEAD** `1394a3f...`.
- Apache-2.0; the full upstream LICENSE at the approved pin is bundled unchanged as `third_party/licenses/tradingagents-Apache-2.0.txt` (Git blob `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`). The audit validator verifies the exact Git blob. Source mechanisms inspected and adapted: `tradingagents/agents/utils/rating.py` (five ratings and nontradeable `REVIEW`), `tradingagents/graph/conditional_logic.py` (bounded bull/bear alternation).
- LiOS files: `src/server/tradingAgentsResearchGate.mjs`, `src/server/tradingAgentsResearchGate.d.mts`, `src/server/tradingAgentsResearchGate.test.mjs`, `src/server/tradingAgentsResearchTool.ts` and `src/server/tradingAgentsResearchTool.test.ts`.
- The adaptation deliberately **does not import** the upstream LangGraph graph, autonomous brokerage/trader logic, provider defaults, LLM credentials, market-data fetches, checkpoint/memory authority or model output as fact.

## Core behavior

1. Parse explicit typed rating/recommendation labels into five-tier vocabulary. NFKC and markdown labels are recognized; conflicting labels, rating scale echoes and missing labels mean `REVIEW`, **not Hold**. Single-word fallback requires explicit caller opt-in.
2. Gate the bull/bear and three-perspective risk sequences using typed speaker identity and explicit 1–3 round budgets. Model prose does not decide which speaker is next. At the cap, the pure gate returns `human_review` rather than issuing a trade or invoking another worker.
3. Adapt donor missing-opponent and missing-report helpers so unavailable content is explicitly absent, not a fabricated opposing argument. Parsed model output is always `unverified_model_output`. The gate cannot create evidence refs, price observations, Decision approval or broker actions. GM-12, P5/P7 and P4 remain the corresponding authorities.
4. A bounded `ConversationToolDefinition` adapter is implemented and can be exercised through `GovernedToolRegistry` in tests. It checks authenticated agent call, exact tenant/Project ownership, cancellation, source scope, and requires a no-side-effect read-only outcome. The feature branch now registers it in the **single existing** `conversationRuntime.ts` catalogue (two-line import/registration); its real registry discovery is covered by `tradingAgentsResearchTool.test.ts`, and shared-core owner coordination is still required before merge. The next acceptance steps are real source-bound evidence/receipts (when available), packaged tests and SP-05 inspection; this is not an autonomous multi-agent trading system.


## Complete upstream donor-package disposition

Per the canonical donor policy §21.2 and §21.10, `third_party/tradingagents-path-dispositions.json` records **all 75 Python source paths** from upstream at pinned Git tree, exact per-file upstream blob SHA, retained/adapted mechanisms, canonical LiOS owners, dependency substitutions and individual defer/replace rationale. Twenty pertinent upstream tests are recorded with blob-level lineage and port/next-qualification disposition. This is **not** 75 files imported, nor blanket runtime, model/provider, broker or packaged approval.

The *coherent selected package* here is the **TradingAgents finance debate/review-control mechanism** across specialist bull/bear researchers, aggressive/conservative/neutral risk debators, graph conditional routing, rating and missing-evidence helpers. Retained mechanics: five-tier classification with REVIEW, role-aware debate transition, explicit opening/absent states, and safe human-review terminal state. Replaced seams: donor graph/checkpointer (GM-12), vendor tools+source provenance (P5/P7), separate model clients (BYOAI), independent memory (P7), broker execution (GM-11/SI-05.37), report files (P4). The source-free substitutions avoid additional Python, LangGraph, vendor keys, Qlib/data stores or unreviewed model assets in this slice.

The remaining analyst team, point-in-time market validator and report/backtest packages are **deferred with triggers**, not falsely rejected: first obtain source-vintage entitlement and a cited P5/P7 research fixture, then port their upstream tests and integrate their useful complete subsystem(s). The decision to avoid wholesale imports follows the evidence rights, competing authority and footprint exclusions recorded *per source file*.

Native policy gate:

```sh
node src/script/validate_tradingagents_adoption.mjs
node --test src/script/validate_tradingagents_adoption.test.mjs
```

## V1 focused test

```sh
cd src && node --test server/tradingAgentsResearchGate.test.mjs
node --import tsx --test server/tradingAgentsResearchTool.test.ts
node --test script/validate_tradingagents_adoption.test.mjs
npm run check
```

This test is independent of external Python/LLM/provider/broker installs. A source helper is not itself a product runtime integration. Preserve original Apache-2.0 notice, exact pin, imported/adapted paths, negative tests and truthful donor registry state when any source is promoted to `main`.
