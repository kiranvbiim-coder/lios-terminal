# LIOS Institutional Model Assurance Standard

Status: release-gate policy; implementation coverage must be qualified per output path
Scope: every analytical result, model run, decision receipt, client deliverable, and material internal decision produced by LiOS. This universal policy scope is not a claim of universal runtime enforcement.

## Objective

LiOS must not equate a successful calculation with a trustworthy decision. A model is decision-grade only when the data, implementation, numerical behavior, validation evidence, reproducibility, uncertainty, and independent challenge are strong enough for the intended use.

The governing principle is:

`Source truth -> point-in-time evidence -> validated model -> uncertainty/challenge -> assurance gate -> decision/output`

No AI-generated explanation, user-interface label, or manual override may promote a weak analytical result beyond the assurance level supported by its evidence.

This cross-cutting standard supports SI-05.23–24 and applicable SP-05/SP-07 journeys under P11 deterministic authority and existing output owners. SI phases are strategic, S0–S10 are validation only, and P14 retains final release authority. Shipping Point acceptance additionally requires a real MSJ, applicable packaged/target execution, no fake success, regression protection and exact evidence; scores or policy text alone cannot establish acceptance.

## Model risk tiers

### Tier 1 — Material decision models

Examples include valuation, DCF/reverse DCF, portfolio risk, credit risk, derivatives pricing, fixed-income pricing, stress testing, capital allocation, forecast-driven investment decisions, project finance, material operating-network decisions, and any model whose output is used directly in a client recommendation or material decision.

Minimum requirements:

- Registered model and immutable model version.
- Point-in-time input snapshot or cryptographic input digest.
- Explicit source/provider identifiers and entitlement status.
- Known-answer golden cases with documented absolute and relative tolerances.
- Boundary and invariant tests.
- Independent challenger or cross-engine validation where a credible independent implementation exists.
- Provider reconciliation for externally observable material inputs where multiple sources are available.
- Explicit uncertainty or sensitivity analysis.
- Out-of-sample or historical backtesting when the model makes forecasts, classifications, or time-series inferences.
- Seeded and convergence-tested stochastic calculations.
- Numerical diagnostics and warnings preserved with the result.
- Reproducible validation artifact and SHA-256 report digest.
- Institutional assurance band before the result may be labeled a material decision.

### Tier 2 — Analytical support models

Examples include descriptive analytics, secondary screeners, diagnostic statistics, supporting portfolio analytics, research transformations, and calculations used as evidence but not as the sole basis of a material decision.

Minimum requirements:

- Registered versioned model.
- Regression tests.
- Boundary/invariant tests appropriate to the model.
- Data provenance and freshness metadata.
- Reproducibility controls.
- At least implementation-reviewed validation, with stronger validation required before client advisory use.

### Tier 3 — Exploratory/research models

Experimental, synthetic-only, prototype, heuristic, or research-stage models are allowed for exploration. They must be visibly identified as research-only and cannot be silently promoted into client advisory or material-decision outputs.

## Promotion ladder

Promotion is evidence-based, not feature-completion based.

`not_started -> research_only -> benchmark_required -> implementation_reviewed -> regression_tested -> known_answer`

A model may be marked `validated` only when its registered validation level and attached evidence justify that status. Synthetic-only models cannot be promoted directly to validated.

## Assurance bands

### Institutional

Required for material decisions. Target score >= 93 with:

- known-answer validation,
- no blockers,
- no unresolved warnings,
- every assurance component >= 85,
- explicit uncertainty treatment,
- independent challenger pass,
- reproducible inputs and model version.

### Decision grade

Required for client advisory. Target score >= 84 with no blockers and each assurance component >= 70.

### Review required

Permitted for controlled internal analysis. Human review is mandatory before downstream use.

### Research only

Permitted only for exploration, model development, and hypothesis generation.

### Blocked

The result must not be used as an analytical output. Typical blockers include critical source conflicts, failed known-answer/cross-engine evidence, invalid entitlement, missing provenance, non-finite outputs, or a false validation claim.

## Numerical tolerance policy

Every golden output must define both an absolute and relative tolerance.

Acceptance uses:

`|actual - expected| <= absolute_tolerance + relative_tolerance * |expected|`

This avoids false failures around zero while preventing large values from passing on an overly generous fixed tolerance. Tolerances must be chosen from numerical/financial materiality, not retrofitted merely to make a test pass.

For cash, price, yield, risk and probability outputs, the validation fixture must document units and scaling. Silent unit coercion is prohibited.

## Provider reconciliation

For material externally observable inputs, LiOS should cross-check independent providers where practical.

Rules:

- One provider gets one current vote per reconciled metric; duplicate historical observations must not increase provider weight.
- Latest valid observation per provider is used within a single-metric reconciliation.
- Units must match before numeric reconciliation.
- Median and median absolute deviation are the default robust center/outlier method.
- Outliers are preserved in the evidence record rather than silently discarded.
- Provider freshness and explicit provider confidence may influence the canonical estimate.
- The reconciliation must be deterministic for identical observations and reference time.
- Two providers are the minimum useful cross-check; three independent providers are preferred for institutional-grade externally observable facts where licensing and availability permit.
- Material unresolved provider conflict blocks decision-grade promotion.

Provider agreement never substitutes for primary-source authority. For regulatory filings, official statistical releases, legal disclosures, and other authoritative records, source hierarchy must be considered explicitly.

## Point-in-time and anti-lookahead rules

Backtests, forecasts, historical valuations and event studies must use only information that was actually available at the evaluated time.

Required controls include:

- dataset effective time,
- publication/release time where available,
- revision/vintage metadata,
- corporate-action normalization metadata,
- snapshot hash,
- provider/source identity,
- model version and calculation time.

Using later-restated data in an ostensibly historical decision must be flagged as lookahead unless the analysis explicitly asks for a restated view.

## Forecast validation

Forecasting models require more than in-sample fit.

At minimum:

- rolling or expanding-window out-of-sample evaluation,
- naive/base-rate benchmark comparison,
- error metrics appropriate to the target,
- calibration assessment for probabilistic predictions,
- regime/subperiod diagnostics where sample size permits,
- feature leakage checks,
- explicit forecast horizon,
- historical vintage discipline.

A sophisticated model that cannot beat a simple benchmark reliably must not receive a stronger assurance rating solely because it is more complex.

## Stochastic and Monte Carlo models

Every validation run must carry an explicit seed. Production material runs must preserve the seed in the run envelope.

Where Monte Carlo is material, validation should include:

- convergence/stability checks,
- sensitivity to seed/sample count,
- distribution diagnostics,
- variance-reduction method disclosure where used,
- confidence intervals or simulation error estimates.

An unseeded stochastic result cannot be used as evidence for known-answer validation.

## Independent challenge

Tier 1 models should be challenged by an implementation that does not simply call the same code path.

Examples:

- TypeScript DCF challenged by independently implemented Python/reference workbook fixtures.
- QuantLib bond price challenged by published analytical examples or independent formulas for simple instruments.
- Portfolio optimization challenged against a separate solver/reference fixture.
- Option pricing challenged against closed-form known answers for Black-Scholes before advanced volatility models are trusted.
- Statistical estimators challenged against trusted library/reference outputs on frozen fixtures.

A self-comparison is regression testing, not independent validation.

## Reproducibility artifact

A material validation report must be reproducible from recorded artifacts. At minimum preserve:

- model ID and version,
- engine version,
- canonical input digest,
- point-in-time dataset snapshot digest where applicable,
- sorted provider IDs,
- deterministic/stochastic classification,
- seed where applicable,
- expected and actual outputs,
- tolerances,
- invariant results,
- validation report digest.

Identical validation inputs and versions must generate identical digests. Hidden wall-clock dependence is prohibited in deterministic validation logic.

## Evidence freshness and expiry

Validation evidence is not immortal. Evidence must be renewed when any of the following materially changes:

- model implementation,
- numerical library or solver,
- contract/schema semantics,
- source transformation logic,
- material provider behavior,
- calibration methodology,
- model assumptions,
- regulatory or market convention relevant to the model.

Evidence artifacts should support `validatedAt` and `expiresAt`. Expired critical evidence reduces assurance until renewed.

## Decision/output gating

LiOS output paths must use output criticality, not user confidence, to decide the minimum required assurance.

- Exploratory: research-only or better, but no unresolved blockers.
- Internal analysis: review-required or better.
- Client advisory: decision-grade or institutional.
- Material decision: institutional only.

A high composite score cannot compensate for a critically weak component. Material outputs require minimum component floors and zero blockers.

Current source evidence identifies `decisionAssuranceGate.ts` checks and their integration in `decisionRoutes.ts`; it does not establish enforcement across every finance Artifact, export or client-deliverable path in this policy's scope. Legacy `modelAssurance.ts` scoring can assign a band before the full output gate. A score/band is not gate passage: P11 and each canonical output owner must qualify route integration, fail-closed behavior and actual known-answer/challenger/provider/OOS/reproducibility evidence before claiming universal enforcement or institutional delivery.

## Decision receipt integration

Every client-advisory or material-decision receipt should carry an assurance attachment containing:

- output criticality,
- model risk tier,
- model/engine version,
- validation level,
- assurance band and score,
- component scores,
- input/data snapshot hashes,
- provider IDs,
- evidence artifacts,
- uncertainty summary,
- challenger status,
- blockers/warnings,
- gate version and result.

This makes the final output auditable even after the underlying system evolves.

## Fail-closed conditions

LiOS must block promotion when any critical condition is true, including:

- known-answer or independent cross-engine evidence failed,
- material input has an unresolved critical source conflict,
- source entitlement is invalid or unknown when required,
- required provenance is missing,
- expected output is missing or non-finite,
- stochastic validation lacks a seed,
- model claims a validation level unsupported by evidence,
- material decision carries unresolved assurance warnings,
- required model/data version cannot be reconstructed.

The correct institutional behavior is to show that the answer is not sufficiently trustworthy yet, not to manufacture precision.

## Release requirement

A LiOS release may add advanced models freely, but no model may be advertised as institutional or material-decision grade merely because the code exists. Promotion requires passing evidence under this standard. Model assurance should therefore become a release artifact alongside ordinary unit, integration, security and provider tests.
