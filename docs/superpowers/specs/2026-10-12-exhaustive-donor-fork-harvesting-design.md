# Exhaustive Donor & Fork Harvesting — Design

**Date:** 2026-10-12  
**Status:** Owner-approved; governance/enforcement implementation active in PR #656  
**Base:** `main` at `0e77f1a1a1ca78d562071afbab1cb9efd91f6e0f`  
**Applies to:** SI-01–SI-07, GM, TC, CA and all canonical P-owner implementation work  
**Canonical policy:** `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

## Core decision

LiOS must obtain the maximum practical engineering leverage from approved donors, controlled forks and useful fork deltas before implementing commodity functionality from scratch. The objective is not to install every donor or copy upstream products. The objective is to harvest proven packages, mechanisms, algorithms, utilities, tests and fork improvements, then adapt them behind existing LiOS authorities.

Mandatory sequence:

> **DISCOVER → SOURCE-AUDIT → DECOMPOSE → FORK-MINE → REUSE → IMPORT → ADAPT → REPURPOSE → COMBINE → GENERALIZE → IMPROVE → PORT TESTS → PACKAGE → BUILD ONLY THE REMAINDER**

## Architecture boundary

No donor/fork may create a competing LiOS authority. GM owns runtime/execution/agents/devices/browser/local-AI platform mechanics; TC owns visible experience; P4 owns Artifact state; P5 owns canonical identity/data semantics; P11 owns deterministic finance; P13/GM own skills/MCP/plugin authority. Donor mechanics live underneath/behind those authorities.

## Scope and accounting

- Preserve the exact 92 baseline donors in `third_party/capability-assimilation.json`.
- Preserve the 10 controlled forks in `third_party/controlled-fork-utilization.json` unless deliberately amended through canonical evidence.
- Supplemental/community forks do not silently become baseline donors.
- Fork HEAD is observation evidence, not an approved source pin/import/shipping claim.

## Source audit and dispositions

Repository metadata/README review is not a full audit. Active donor work must inspect the complete coherent useful package or cross-package capability slice, including material source paths, utilities, algorithms/state machines, recovery/checkpointing/replay, security/permissions, persistence/sync, packaging/platform code, dependencies, examples, upstream tests/fixtures, optional assets and rights boundaries.

Audit states:
- `not_started`
- `metadata_reviewed`
- `partial_source_audit`
- `full_useful_package_audit`

A full audit requires 100% evidence-backed disposition of identified material paths, mechanisms and applicable upstream-test groups.

Path/mechanism dispositions include direct reuse/import/adapt/repurpose/combine/generalize/innovate/reference/defer and explicit authority/unused/rights/security/platform exclusions or reject-with-evidence. Rejecting an upstream product does not automatically reject its useful internal mechanisms.

## Fork-delta mining

High-value donor work should inspect the controlled fork and, when material, upstream/community fork deltas for security fixes, platform support, packaging/dependency simplification, recovery/checkpoint improvements, performance, algorithms, tests, protocol compatibility and bug fixes.

Fork review states:
- `not_applicable`
- `controlled_fork_reviewed`
- `ecosystem_screened`
- `material_forks_deep_reviewed`

Community-fork code becomes adoptable only after exact repository/commit/path rights, provenance, canonical owner, dependencies, tests and LiOS destination are recorded through existing evidence mechanisms.

## Cross-donor composition

Complementary donors may be combined behind one canonical LiOS contract. Composition must converge into one LiOS capability, never parallel donor products/stores/routers/permission systems/engines/agent stacks.

## Upstream-test harvesting

Applicable upstream tests are reusable engineering assets. Review and port applicable tests with lineage; retain or strengthen assertions; adapt fixtures to LiOS; add LiOS authority/security/cancellation/restart/unavailable-state/provenance/known-answer/packaged-target coverage as applicable. Deep harvesting requires 100% disposition of identified applicable test groups, not necessarily 100% porting.

## Donor Exhaustion Record / scratch-build lock

Substantial commodity capability may not be declared donor-exhausted or justified as a scratch-built replacement without a Donor Exhaustion Record covering relevant donors, controlled forks, material community-fork screening, useful package/source paths, upstream tests, direct import/package-minus-exclusions, authority-seam replacement, dependency substitution/wrapping/adaptation/repurposing, cross-donor composition, exact build-new remainder and concrete reason for native code.

Insufficient reasons on their own: easier to rewrite; different domain; not designed for LiOS; integration is difficult.

## Machine enforcement

`third_party/donor-harvesting-controls.json` is a vocabulary/rule surface only, not a second donor registry. Existing donor ledgers remain truth.

The universal validator rejects:
- full-audit claims without complete path/mechanism/test dispositions;
- exhaustion without its record;
- forbidden scratch-build shortcuts;
- invalid fork delta-review/disposition states;
- fork observation promoted as import;
- 92+10 identity drift;
- shipping/integration inflation.

Baseline donor/component/upstream-pin snapshots remain strict. Controlled-fork harvesting metadata is validated directly, avoiding false drift caused by legitimate fork-delta evidence updates.

## Utilization metrics

Measure Source Audit Coverage, Mechanism Disposition Coverage, Path Disposition Coverage, Test Harvest Coverage, Fork Review Coverage and actual Reuse Leverage. Do not optimize for “92 donors installed.”

## Execution and rollout

This creates no new roadmap. Execution remains SI + existing GM/TC/CA/P owners + issue #192 + V0–V4 + SP-01–SP-07 + P14.

Stage A: canonical policy + control vocabulary + validator integration + controlled-fork metadata are implemented in PR #656 pending review/merge and full-ledger V1 execution.

Stage B: apply first to OpenClaw, Qlib, TradingAgents, LangAlpha, FinRobot, GraphRAG, browser-use, CUA and dexter-js when their canonical owner selects a bounded capability slice.

Stage C: sweep the remaining 92 baseline entries owner-by-owner with evidence-based package/mechanism/fork/test dispositions.

Stage D: continue triggered fork/upstream intelligence without auto-sync.

## Verification boundary

PR #656 has focused RED→GREEN evidence for the standalone harvesting gate: 5 focused tests passed and Node syntax checks passed. The full `validate_universal_donor_adoption` integration test is committed but was not executable in this harness because the complete repository/large ledgers could not be cloned/materialized locally due network/DNS limitations. It remains required in a real repository checkout/self-hosted environment before merge. No Shipping Point/release truth is claimed.

## Final invariant

> **Harvest proven implementation as deeply as practical. Mine useful fork deltas. Combine complementary donors. Preserve canonical LiOS authorities. Port useful upstream tests. Build only the LiOS-specific remainder after evidence-backed exhaustion.**
