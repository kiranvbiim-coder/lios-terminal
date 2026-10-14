# SI-01.13 Resource Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SI-01.13 with truthful CPU/RAM/storage/time/output/process-count admission, enforcement where supported, graceful degradation, and hardware-aware safety across canonical execution backends.

**Architecture:** Extend the existing `ExecutionBackend` request/capability contract rather than inventing another scheduler. Each backend advertises only enforceable limits; requests stronger than the backend can prove fail closed or select a stronger available backend. Supervisor time/output/cancellation bounds remain canonical.

**Tech Stack:** TypeScript, existing GM-10 supervisor and GM-11 `ExecutionBackend` contracts, Node/container/local execution providers.

**Spec:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` SI-01.13, `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`.

## Global Constraints
- Consume #237/#241 and later backend implementations; do not fork their resource semantics.
- Do not label CPU-rate controls as exact cumulative CPU-time limits.
- Unsupported hard limits must remain `unsupported`, not best-effort success.
- R3 for enforcement/shared core; V0 + V1 + relevant V2; V3 deferred to SP-01.

## Review Focus
- backend capability advertisement matches real OS/runtime enforcement;
- limit tightening cannot be weakened downstream;
- cancellation/timeout kills descendants and releases resources;
- low-memory/disk conditions fail safely before destructive work;
- default limits remain usable on the owner's 16 GB development Mac and degrade predictably on smaller systems.

---

### Task 1: Canonical resource-policy vocabulary
- [ ] Add/complete tests for time, retained output, process count, RAM, CPU and storage requirements.
- [ ] Keep one capability/admission schema in the existing backend contract.

### Task 2: Backend enforcement matrix
- [ ] Local backend: preserve only limits the GM-10 supervisor genuinely enforces; refuse stronger requirements.
- [ ] Container/other strong backends: map enforceable RAM/PID/storage/time controls precisely and document semantics.
- [ ] Add real limit-exhaustion tests where supported.

### Task 3: Hardware-aware admission and graceful degradation
- [ ] Add safe preflight for available memory/disk and backend/runtime availability where the operation requires it.
- [ ] Define explicit unavailable/degraded responses rather than partial hidden execution.
- [ ] Prevent simultaneous heavy jobs from oversubscribing configured local capacity where canonical scheduling already has an owner.

### Task 4: Cleanup/observability integration
- [ ] Ensure timeout/cancel/limit termination reaches execution journal/receipts with the real reason.
- [ ] Prove descendants/resources disappear after enforced termination.

### Task 5: V2 evidence
- [ ] Run representative memory/PID/time/output/cleanup checks on the self-hosted macOS target and any required container backend.
- [ ] Record unsupported CPU/storage semantics explicitly.

### Foundation continuation — 2026-10-07

The real governed-command positive regression uses an isolated real GM-10 supervisor wrapped by the canonical reservation pool with deterministic capacity inputs. It proves native output/marker creation and reservation release after extinction without depending on ambient developer disk/memory pressure. Production execution still reads actual host capacity; this fixture does not qualify packaged admission or lower safety reserves. Resource refusal tests remain separate and fail closed.

The current inline-Node backend is no longer dependency-pending in the isolation inventory. Its optional V2 probe runs real filesystem-read, raw-network and child-process denial through the canonical backend runner. This does not authorize workspace grants or imply browser/long-lived-sidecar isolation; those surfaces require their own runtime evidence.
