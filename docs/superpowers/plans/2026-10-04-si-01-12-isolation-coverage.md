# SI-01.12 Isolation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SI-01.12 by applying enforceable, truthful isolation boundaries to the risky execution classes required by the Secure Local Alpha without weakening canonical LiOS authorities.

**Architecture:** Reuse the canonical `ExecutionBackend` contract from GM-11c and the concrete Node/container backends from #239/#241. Add only the missing isolation adapters/policies for Python, browser, document processors, finance/runtime packs and workspace transfer. Unsupported guarantees must remain explicitly unavailable.

**Tech Stack:** TypeScript/Node.js, existing GM-10/GM-11 exec backend contracts, Python sidecar/runtime contracts, browser provider, document/finance sidecar owners.

**Spec:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` SI-01.12, `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`, issue #233.

## Global Constraints
- #237 owns the backend contract; #239 and #241 own concrete Node/container backends. Consume them; do not recreate them.
- No generic host bind-mount shortcut that weakens the sandbox boundary.
- Isolation claims must be proven with real denial tests on supported target/runtime; otherwise report unavailable.
- Risk R3; V0 + V1 + relevant V2. V3 deferred to SP-01.

## Review Focus
- safe workspace/data transfer into isolated processes without exposing sockets/devices/host handles;
- Python/document/browser/finance processors cannot escape their declared file/network/process boundary;
- credentials are resolved narrowly and never baked into images/argv/logs;
- unsupported isolation on macOS/Windows is explicit rather than silently downgraded;
- cancellation kills isolated descendants and leaves no orphan container/process.

---

### Task 1: Isolation coverage matrix
- [x] Inventory risky execution classes required by SI-01/SP-01 and map each to an existing backend/isolation owner.
- [x] Add contract tests that reject stronger-than-advertised isolation/resource claims and stale owner paths. Repository V1 execution remains pending.

### Task 2: Safe workspace/data bridge
- [x] Design/reuse a governed copy/fs-bridge mechanism for explicit files only; never mount a generic host workspace into arbitrary sandboxed shell code.
- [x] Add focused tests for traversal, symlink/socket/non-regular rejection, ingress-only vs write-return semantics and integrity hashes. Repository V1/V2 execution remains pending.

### Task 3: Python/document/finance isolation integration
- [x] Route the applicable one-shot document/spreadsheet jobs through isolated routes: P7 Docling, Project PDF via P7 Docling, and XLSX/CSV SheetJS parsing via a normalized snapshot worker.
- [x] Add one canonical strict sandbox runtime profile (`LIOS_EXECUTION_ISOLATION=strict`) with immutable image, explicit local Docker/Podman socket, non-root user and pinned in-image tool paths; wire the real Project attachment and spreadsheet-import paths to select it without host fallback.
- [x] Keep existing deterministic/Artifact engine ownership: isolation only wraps parser transport; P7 remains the document parser authority and P4 remains SpreadsheetArtifact authority.
- [x] Add strict fail-closed refusal for Python HTTP sidecars, P11 LEP sidecars and managed Python provisioning where current lifecycle/network contracts cannot prove isolation.
- [x] Add executable real-target V2 denial tests for file/network/process access where isolation is claimed; target execution/evidence remains Task 5's external acceptance step.

### Task 4: Browser/runtime boundary reconciliation
- [x] Extend the canonical backend vocabulary with brokered network isolation and gate strict Playwright startup against sandboxed filesystem/process plus brokered egress capability.
- [x] Record the current transport as explicitly unsupported: strict mode refuses host Chromium even after capability-only admission until a real isolated Playwright transport exists.

### Task 5: V2 target proof
- [x] Add `npm run acceptance:si01-isolation-v2`: a machine-readable macOS Docker/Podman harness that proves required copy-bridge, host-filesystem denial, external-network denial, runtime hardening, PID ceiling and cancel/extinction guarantees, and records Docling/Project-PDF/spreadsheet/browser/sidecar states.
- [x] Add a versioned evidence contract (schema v2) that records the exact local engine socket, fails acceptance on any required non-pass result, rejects non-local engine targets, and refuses non-macOS evidence.
- [x] Bind the harness to the same explicit local engine socket used by the sandbox runtime; post-cancel inspection never uses ambient Docker/Podman context.
- [x] Wire the existing self-hosted macOS LIOS Quality Gate to run the harness for SP-01/GM-11 targets and upload the evidence artifact.
- [ ] Run the harness on the self-hosted packaged macOS target with immutable runtime image(s).
- [ ] Commit/link the resulting target evidence and mark exactly which optional guarantees remain unavailable.
