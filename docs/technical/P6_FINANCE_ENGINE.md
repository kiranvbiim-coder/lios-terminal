# P6 Finance Engine — supporting technical specification

**Subsystem goal:** move from a financial question or strategy idea to a deterministic model/backtest, inspect assumptions/results, modify inputs and rerun inside LiOS.

The [SI execution plan](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) governs strategic execution; P6 contributes chiefly to SI-05 and SI-04 through existing P11/P4 authorities. [LIOS_EXECUTION_ROADMAP.md](../LIOS_EXECUTION_ROADMAP.md) retains canonical task and historical evidence detail, not a competing phase order. S0–S10 are validation journeys only.

## Product rule

LiOS deterministic finance remains the calculator of record. AI may explain, navigate, retrieve, configure, draft or provide an explicitly user-authorized AI-derived estimate, but it must not silently replace deterministic numerical engines.

P6 converges existing valuation, portfolio/risk, fixed-income, derivatives, macro, SEC/XBRL and reporting work. It does not create parallel copies of those engines.

## Canonical P6 tasks

| ID | Implementation / decision |
| --- | --- |
| LIOS-P6-01 | Company/fundamentals route remains on the governed Data Fabric + semantic finance + SEC/XBRL stack and is registered in `P6_FINANCE_WORKFLOWS`. |
| LIOS-P6-02 | Valuation engines remain authoritative; `buildValuationDecisionSupport` adds candidate-only DecisionArtifact structure with no automatic external action. |
| LIOS-P6-03 | Existing portfolio optimizers/risk engines are retained; `buildPortfolioRebalanceDecision` creates explicit target-weight deltas and candidate-only decisions. |
| LIOS-P6-04 | Fixed income and derivatives are registered as conversational deterministic workflows over existing engines. |
| LIOS-P6-05 | Macro/FX, alternatives and corporate-actions/events converge through the same governed workflow registry/Data Fabric. |
| LIOS-P6-06 | Client Artifact export supports JSON/CSV/XLSX/PDF/MD plus an in-repo PPTX OOXML renderer using the already bundled `fflate` dependency. These paths are distinct from deferred P11 server-side XLSX/DOCX/PPTX capabilities; neither proves professional round-trip/citation integrity. |
| LIOS-P6-07 | `rankCapitalAllocationCandidates` provides deterministic, assumption-visible capital-allocation candidate ranking; it does not execute a choice. |
| LIOS-P6-08 | Personal Finance & Wealth is a user-owned-data workflow with deterministic net worth, cash flow, debt, goals and retirement projection. |
| LIOS-P6-09 | Existing SciPy constrained optimizer remains V1 default because it already supports robust constraints, turnover, transaction costs, CVaR, group constraints and uncertainty. skfolio/CVXPY remain qualified optional packs until a measured gap justifies activation. |
| LIOS-P6-10 | EdgarTools is pinned and packaged in the managed `research-sec` runtime (`managed_bundled`). Native SEC/XBRL and filings.xbrl.org remain primary; Arelle stays optional for taxonomy validation rather than becoming a mandatory dependency. |
| LIOS-P6-11 | LEAN stays a non-bundled Advanced Quant Runtime candidate behind LiOS contracts. |
| LIOS-P6-12 | OpenTerminalUI remains a governed donor candidate; no weaker duplicate finance runtime is imported where existing LiOS engines are stronger. Known-answer P6 tests cover the canonical path. |
| LIOS-P6-13 | `runP6Backtest` enforces signal-on-t / execute-on-t+1, fees, slippage, liquidity participation, point-in-time policy, parameter sweeps, true out-of-sample walk-forward windows and seeded Monte Carlo. |
| LIOS-P6-14 | `p6RiskFixedDerivatives.ts` adds marginal/component risk, sector/currency scenario stress and liquidity stress; existing factor/portfolio stress engines remain available. |
| LIOS-P6-15 | Existing Python derivatives engines provide Greeks, implied volatility and surface checks; LiOS strategy payoff analytics remain; P6 adds normalized OI/flow aggregation. |
| LIOS-P6-16 | Existing QuantLib/fixed-income engines provide curves/spreads/key-rate/scenarios; P6 adds deterministic ladder/cash-flow aggregation. |
| LIOS-P6-17 | LSE terminal backtest was audited at pinned commit `62c48a5ce6de37a1c115d6270dfd0eee75166d8b`; useful lifecycle/research patterns are assimilated behind LiOS-owned contracts, not copied as a second product runtime. |
| LIOS-P6-18 | LiOS RSI semantics use Wilder smoothing in both chart indicators and the backtest signal engine; P6 adds fixed known-answer parity tests for RSI/SMA/EMA/MACD warm-up behavior. |
| LIOS-P6-19 | LSE ML remains an optional future Quant/ML Runtime Pack; no heavy deep-learning dependency enters the base desktop. |
| LIOS-P6-20 | Brue at pinned commit `a846522fe8af0e11ee7739ef8b6b8a4c0f7922cb` is a qualified optional strategy/parser runtime. LiOS owns Strategy, sandbox and permission contracts. |
| LIOS-P6-21 | `p6ExecutionIntentSchema` + `buildGovernedExecutionIntent` create a portable Strategy → Backtest → draft execution-intent bridge. P6 performs no broker side effect. |
| LIOS-P6-22 | P6 ports the useful conformance idea as LiOS known-answer/regression suites covering timing, PIT, costs, reproducibility, indicators, lifecycle and safety. |
| LIOS-P6-23 | BacktestEngine abstraction is frozen around LiOS runtime contracts plus `P6BacktestRequest/Result`; reproducibility uses stable SHA-256 identity. |
| LIOS-P6-24 | Backtest Kit at pinned commit `599d990204cd7bfb44ba61c973cc3f742ea43861` remains a qualified optional/donor runtime. V1 standard execution is the smaller LiOS core after benchmark/audit, avoiding broker/runtime bloat. |
| LIOS-P6-25 | LEAN remains behind the same conceptual BacktestEngine boundary and cannot own Project/Artifact/credential state. |
| LIOS-P6-26 | Strategy Studio separates editor choice from validation/sandbox/permission policy. Built-in LiOS rule source is generated from the executable structured parameters and read-only; Brue/JSON remain editable drafts but execution is blocked until their governed runtime adapters are active. Monaco is optional rather than a mandatory desktop dependency. |
| LIOS-P6-27 | The terminal's primary `backtesting` route now calls authenticated `/api/finance/p6-backtest` and renders the P6 Backtest Cockpit; the legacy browser-side calculator is removed from the primary path. Cockpit exposes equity, drawdown, benchmark, trades, exposure, costs, Sharpe/Sortino, provenance and lifecycle. |
| LIOS-P6-28 | Backtest lifecycle is explicit: edited-not-run, running, completed, failed, stale. Historical simulation is explicitly never labelled live performance. |
| LIOS-P6-29 | Personal Finance & Wealth adds user-owned accounts/transactions, cash flow, net worth, debt amortization, goals and retirement projection with explicit assumptions. |
| LIOS-P6-30 | `assertP6CalculatorOfRecord` and Conversation Runtime preserve deterministic finance as calculator of record; AI-direct remains separate and labelled. |

## Backtest correctness contract

1. A strategy may inspect data only through bar **t** when it creates a signal.
2. The earliest fill is bar **t+1**, using the configured next-bar open/close rule.
3. Fees and slippage are applied to every fill; liquidity participation is applied when volume exists.
4. If `pointInTimeRequired=true`, every signal bar must have an `availableAt` clock that makes the data available before the next execution bar. Missing clocks fail closed.
5. If the current Conversation market-data path lacks publication clocks, the run may proceed only with PIT disabled and must carry a warning that PIT is not verified.
6. Reproducibility identity hashes engine version + strategy + data + assumptions.
7. Editing inputs after a completed run makes the result stale.
8. Historical simulation is not live performance and does not imply an executable order.
9. Warm-up/training bars may seed indicators in walk-forward evaluation, but their trades and returns are excluded from the reported out-of-sample test window.
10. The primary terminal backtest screen performs no return calculation in the browser; it invokes the authenticated server-side LiOS engine.
11. Built-in `rules` source is a generated view of structured executable parameters. Optional strategy-language source cannot silently fall through to the built-in engine.

### Numerical evidence bounds

The timing/PIT checks validate supplied `availableAt` values, not the truth of provider publication clocks, revision vintages or corporate-action normalization. Seeded bootstrap/Monte Carlo establishes repeatability, not convergence, confidence intervals or seed/sample sensitivity. Volatility, Sharpe and Sortino use a 252-day convention; material non-daily use requires explicit timeframe qualification rather than automatic annualization claims. Known-answer suites do not by themselves establish universal institutional assurance across every analytical Artifact/export path; independent challenger, provider reconciliation, tolerances, OOS/leakage and uncertainty evidence remain required under the numerical assurance contract.

## Donor/runtime posture

- **Built in:** LiOS deterministic backtest core; SciPy portfolio optimization; QuantLib fixed income.
- **Managed bundled:** EdgarTools SEC research inside the packaged Python sidecar.
- **Qualified optional:** Backtest Kit, LEAN, Brue, skfolio, CVXPY, Arelle.
- **Research/parity reference:** LSE terminal backtest/indicators.
- **Rejected as a P6 dependency:** unverified Brue Connect/live-broker source or any donor module that would take ownership of LiOS Project, Artifact, credential, permission or execution state.

## Acceptance

`npm run test:p6` executes the P6 known-answer/regression suite.  
`npm run acceptance:p6` verifies P6-01 through P6-30 are represented by executable contracts, integrations and governed donor decisions.  
The repository-wide LIOS Quality Gate remains the final merge gate.

SP-05 (and SP-04 for professional outputs) acceptance additionally follows the [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md): a bounded real MSJ, target/package execution where applicable, no fake success, regression protection and exact commit/build/topology/checks/limitations evidence. Subsystem tests, deterministic seeds and export availability do not establish accepted Shipping Point status.
