# Exhaustive Donor & Fork Harvesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make exhaustive donor/fork harvesting a canonical, machine-enforced build-before-rewrite gate without creating any new LiOS authority.

**Spec:** `docs/superpowers/specs/2026-10-12-exhaustive-donor-fork-harvesting-design.md`

**Canonical policy:** `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md`

## Constraints

- Preserve the frozen 92-donor baseline and 10 controlled forks.
- Preserve GM/TC/P4/P5/P11/P13 authority boundaries.
- Community fork discovery is not import approval.
- Full useful-package audit requires complete material-path/mechanism/test disposition.
- Donor exhaustion/scratch-build claims require a Donor Exhaustion Record.
- No full hosted Quality Gate for this R1 governance-validator change; focused local validation first.

## Completed implementation

- [x] Canonical policy amended with exhaustive harvesting.
- [x] Non-registry harvesting control vocabulary added.
- [x] Standalone harvesting gate + focused TDD tests added.
- [x] Existing universal donor validator integrated with harvesting promotion checks.
- [x] Integration regression tests committed.
- [x] All 10 controlled forks record delta-review/provenance/next-trigger evidence.
- [x] Strict baseline/component/upstream-pin snapshots retained; fork evidence validated directly.
- [x] Whole-PR review fixed weak fork disposition validation with an explicit whitelist.
- [x] PR left unmerged; no product/runtime/Shipping Point/release truth promoted.

## Verification truth

- Standalone harvesting gate RED→GREEN: **5 tests passed, 0 failed**.
- Node syntax checks for standalone gate/test: **passed**.
- Full universal-ledger integration test is committed but **not run in this harness**, because the complete repository/large ledgers could not be cloned/materialized locally due network/DNS limits. It remains a pre-merge V1 requirement on a real checkout/self-hosted environment.

## GitHub coordination

- PR #656 must carry the implementation summary and verification limitation.
- Issue #192 must record that, after merge, substantial scratch-build claims require the Donor Exhaustion Record and active donor work follows the stronger sequence.

## Next rollout after merge

Apply the gate first to OpenClaw, Qlib, TradingAgents, LangAlpha, FinRobot, GraphRAG, browser-use, CUA and dexter-js, then sweep the remaining 92 entries owner-by-owner. Each audit stays under its existing canonical owner; this is not a second roadmap.
