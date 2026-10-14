# LiOS v1.0.0 Finish and Multi-Device Convergence Design

**Status:** Design for owner review — implementation is not authorized by this document alone.

**Date:** 2026-10-11

**Program authority:** Issue #192, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`, `docs/technical/LIOS_PROGRESSIVE_VALIDATION_CI_STRATEGY.md`, and current `main` remain authoritative. This design is subordinate to those authorities and must not create a competing runtime, router, Gateway, permission system, data store, Working Context, Artifact authority, entity authority, finance-engine authority, plugin/MCP stack, device authority, or sync authority.

## 1. Purpose

LiOS has reached the point where adding more isolated capabilities faster than they are integrated creates product risk. The v1 finish program therefore changes the optimization target from **capability count** to **one coherent, packaged, user-accessible product**.

The finish sequence is:

1. **F1 — Consolidate** the current branch/PR and security/integration debt into trustworthy `main`.
2. **F2 — Finish Intelligence** by closing the minimum serious SI-05 capability envelope behind canonical authorities.
3. **F3 — Prove SP-05 Financial Intelligence Alpha** as a real packaged end-to-end journey.
4. **F4 — Finish SI-06 Autonomous & Everywhere Intelligence**, with LiOS Home and multi-device continuity as first-class product behavior.
5. **F5 — Converge SI-07** into one coherent UX, setup, reliability, Doctor/repair, upgrade, backup and restore experience.
6. **F6 — Release** through SP-07, V4 and P14.

The core product promise remains:

> **LiOS is a user-owned intelligence system. The user's Home is the normal customer runtime authority; Limuria does not need to host normal customer intelligence data or compute.**

## 2. Fixed architectural constraints

The following are non-negotiable for v1 unless the owner explicitly changes them:

- Desktop-first and local-first remain the default experience.
- LiOS Home is user-owned and may run on the same desktop, another desktop, a Mac mini, NAS, home/office server, user VPS, or user cloud account.
- The Limuria-operated control plane is limited to account/license/entitlement/update-oriented responsibilities and must not become the normal customer Project/Chat/Artifact/intelligence runtime.
- BYOAI and BYOD remain first-class. A remote device may invoke AI or data connectors through the user's Home without Limuria becoming the token/data intermediary.
- Canonical server-side permission, Project, Artifact, P5 identity, P7 evidence, P11 deterministic calculation, Gateway and execution authorities remain singular.
- No fabricated figures, evidence, citations, provider provenance, completion state, or shipping evidence.
- Consequential operations must be re-authorized/revalidated at the point of action.
- Existing donor/reuse policy remains: inspect → reuse/import/adapt/modify/combine/wrap → build from scratch only when necessary.

## 3. Current-state truth at design start

This design starts from `main` at the current repository head observed during design work, after the recent donor/GraphRAG/FinRobot source-truth updates. The exact implementation plan must refresh `main` again before code work begins because the repository is actively moving.

### 3.1 Existing multi-device foundation to reuse

The repository already has a meaningful device-network foundation in the canonical server/Gateway path. Existing tests demonstrate or target the following behavior:

- device networking is disabled by default;
- no TLS identity/listener is created until the owner opts in;
- enabling device networking creates a real TLS endpoint;
- Home identity/fingerprint persist across restart;
- device traffic uses the dedicated `wss://.../gateway/device` path;
- ordinary HTTP routes remain unavailable on the device listener;
- malformed/query/suffixed device upgrade paths are rejected;
- shutdown closes remote/pre-auth/incomplete TLS sockets without killing local UI sockets;
- failed binds/startup fail closed and preserve saved owner intent;
- start/update/stop transitions are serialized;
- advertised URLs are bounded and deduplicated;
- inbound sockets are bounded;
- optional LAN discovery is modeled through mDNS/`lios-home` advertisements.

These primitives are the starting point. F4 must **extend them**, not create a second device transport or another Gateway.

### 3.2 Current product-convergence problem

The current SI-05 program has substantial bounded capability in draft/stacked PRs, but integration truth is distributed across branch ancestry, temporary validation PRs and issue comments. The finish program treats integration debt as product debt.

Before SI-06 productization, F1/F2/F3 must resolve the critical current risks, including:

- stale branches versus current `main`;
- the paper-action organization-boundary regression and required GREEN repair;
- the observed-quote V2 regression failure;
- P11 shared manifest/router serialization around its current owner;
- stale temporary validation PRs after evidence capture;
- stale control-board descriptions that no longer match real implementation/evidence.

## 4. Finish-program architecture

### F1 — Integration Consolidation

**Goal:** make `main` the trustworthy product truth again.

Required outcomes:

- reconcile #192 and active SI control issues with current PR/evidence state;
- repair security/correctness blockers before merging their ancestor stacks;
- serialize high-conflict/shared-core owners;
- rebase or restack old SI-05 branches onto current `main`;
- close temporary validation wrappers after immutable evidence has been recorded;
- merge only dependency-correct, evidence-qualified durable PRs;
- do not open large new capability families while the consolidation queue is unstable;
- add/restore repository merge protection appropriate to multi-agent shared-core development when administratively available.

**Exit condition:** the remaining open stack is small, intentionally ordered, and every accepted capability exists on current `main` with its truth level recorded.

### F2 — Finish Intelligence

**Goal:** finish the minimum serious intelligence envelope needed for LiOS v1 rather than maximize feature count.

The capability families to converge include:

- market/company/fundamental intelligence and identity;
- DCF, residual income, EVA, trading comparables and related valuation conventions;
- scenarios, sensitivities and governed assumptions;
- portfolio, risk, optimization and factor analytics;
- fixed income and derivatives;
- macro and FX;
- research-to-model/thesis composition;
- earnings, estimates, consensus/disagreement and event intelligence;
- corporate-action impact;
- private-market/fund analytics;
- personal finance/wealth planning;
- numerical truth, evidence classes and cross-engine reconciliation;
- living Artifacts / Decision Objects;
- governed paper/simulated action lifecycle.

A capability is not considered product-complete merely because a formula or tool exists. The important v1 pathways should converge toward:

> **evidence/data → deterministic or governed engine → AI interpretation → Artifact/Decision Object → revision → provenance/truth state**

### F3 — SP-05 Financial Intelligence Alpha

SP-05 is the first major integrated proof of the finished intelligence product.

Recommended flagship journey:

> “Analyze a named company after a dated material event/earnings update, identify what changed, revise explicit valuation assumptions, rerun deterministic valuation/scenarios, show portfolio/risk impact, update a living thesis/Decision Object, produce professional output, and optionally prepare a governed paper action. Restart LiOS and prove the evidence, calculations, assumptions, Artifacts and receipts persist.”

SP-05 requires V3 only after the subsystem-specific V0/V1/V2 failures have been diagnosed and fixed. Full-gate reruns must not be used as a debugging loop.

## 5. LiOS Home and multi-device architecture

### 5.1 Authority model

LiOS Home is the authoritative user-owned runtime for multi-device v1.

```text
                Limuria Control Plane
          account / license / entitlement / updates
                         |
               no normal Project data
                         |
                  +------v-------+
                  |   LiOS Home  |
                  | user-owned   |
                  |              |
                  | Projects     |
                  | Chats        |
                  | Artifacts    |
                  | Memory       |
                  | Connectors   |
                  | BYOAI        |
                  | Automations  |
                  | Engines      |
                  | Gateway      |
                  +--+---+---+---+
                     |   |   |
                 Desktop Mobile Tablet
                         |
                       Watch
```

For v1, Home is the source of authoritative Project/Chat/Artifact/automation state. Devices are trusted clients with explicit grants and optional bounded offline caches.

This deliberately avoids introducing a generic peer-to-peer multi-master state authority or a Limuria-hosted sync database.

### 5.2 Deployment modes

LiOS supports four logical modes using one authority model:

1. **Local mode** — desktop client and Home run on the same machine; zero networking setup required.
2. **LAN mode** — paired devices reach Home directly on the local network, using the existing device-network/Gateway foundation and optional discovery.
3. **Remote Home mode** — paired devices reach the user-owned Home over an authenticated encrypted path controlled by the user.
4. **Offline companion mode** — selected encrypted content remains readable on the device; bounded version-bound mutations may queue for later reconciliation where safe.

### 5.3 Remote connectivity

The preferred v1 order is user-owned/private connectivity rather than a Limuria data relay:

- private network/tunnel such as a WireGuard/Tailscale-style topology;
- user-managed domain/reverse proxy where appropriate;
- user VPS/cloud-hosted LiOS Home;
- later, an optional Limuria rendezvous/discovery service may help endpoints find each other, but it must not become the normal Project/content relay or intelligence runtime.

The design must keep remote connectivity transport-agnostic behind the existing Gateway/device identity boundary.

### 5.4 Device roles

**Desktop/Laptop — full LiOS**
- complete research/modeling/Artifact/editing/coding/computer-use/connectors experience;
- may itself host LiOS Home.

**Tablet — professional companion/workspace**
- chat/research;
- dashboards/charts;
- document and Artifact review/edit where supported;
- annotations and approvals;
- presentation/review-oriented workflows.

**Mobile — intelligence companion**
- chat and voice;
- quick research/status;
- Project/Chat access;
- Artifact/Decision review;
- monitor/automation alerts;
- uploads/capture;
- approval/deny of bound consequential operations;
- commands delegated to Home.

**Watch — narrow companion**
- notifications;
- task/monitor state;
- very short summaries;
- approve/deny only where the exact operation digest and policy permit an appropriately constrained approval UX.

The watch is not a modeling terminal.

## 6. Pairing, identity and trust

Multi-device v1 must build on the existing Home identity, TLS fingerprint and Gateway authorization foundation.

Required concepts:

- **Home identity** — stable user-owned Home ID and cryptographic identity.
- **Device identity** — each paired device has a unique revocable identity; a login account alone is not sufficient device trust.
- **Pairing grant** — explicit owner action binds device ↔ Home ↔ user/organization and a bounded initial scope.
- **Certificate/fingerprint verification** — the device verifies it is reconnecting to the same Home; identity changes fail visibly.
- **Revocation** — owner can revoke a device and invalidate future access without rebuilding the Home.
- **Scope** — read/write/automation/approval or narrower abilities follow canonical permission authority rather than a device-specific shadow ACL.
- **Re-check** — remote/queued/consequential work re-checks current authorization before execution.

Pairing UX may use QR/code/manual verification, but the implementation must bind the human-visible ceremony to the cryptographic Home/device identity rather than treating the code itself as a durable secret.

## 7. V1 sync and continuity semantics

### 7.1 Home-authoritative rule

V1 does **not** require a full CRDT or arbitrary concurrent multi-writer replication system.

Instead:

- Home holds authoritative state and revision/version identifiers;
- devices cache selected data, not the entire universe by default;
- writes carry expected version/revision/digest information;
- stale writes fail visibly or create an explicit conflict/revision workflow;
- no device silently overwrites a newer Home state;
- Artifact revisions remain canonical P4 revisions rather than a separate sync-history system.

### 7.2 What may be cached

A device may maintain an encrypted bounded working set such as:

- recent chats;
- explicitly selected Projects;
- selected current Artifact revisions plus necessary provenance metadata;
- task/automation status;
- notification history;
- user preferences needed for the companion experience.

Secrets, connector credentials, raw provider caches, sensitive source documents or large datasets are not automatically replicated merely because a Project is cached. Their replication requires an explicit source/security policy.

### 7.3 Offline behavior

Offline is not fake-online.

Allowed v1 behavior may include:

- read cached content;
- draft chat/user input locally;
- draft notes/annotations or safe version-bound edits where the product contract supports it;
- queue non-consequential intents with their base revision/digest.

Disallowed while Home/required authority is unavailable:

- claiming fresh market/provider evidence;
- running Home-only connectors as if they succeeded;
- executing consequential operations;
- approving an operation whose exact current digest/policy cannot be revalidated;
- silently resolving a stale conflict.

On reconnect:

1. authenticate Home and device;
2. re-check authorization;
3. compare revisions/digests;
4. revalidate freshness where required;
5. apply safe changes or surface explicit conflicts;
6. record provenance/receipts for accepted mutations.

## 8. BYOAI and connectors through Home

LiOS Home is the natural multi-device orchestration point for BYOAI/BYOD.

Examples:

```text
Mobile → LiOS Home → local Ollama / MLX / LM Studio
Mobile → LiOS Home → user's OpenAI / Anthropic / Gemini credentials
Mobile → LiOS Home → user's governed provider/data connector
```

A mobile device therefore does not need to duplicate every model/provider secret. The Home invokes the configured capability under current authorization and returns governed results/receipts.

The design must preserve explicit model/provider identity and must not convert model output into observed financial truth.

## 9. Automations and notifications

SI-06 makes LiOS Home the durable place for long-lived user-owned automations.

Examples include:

- earnings/filing monitors;
- portfolio/event alerts;
- macro indicator monitoring;
- scheduled research/report generation;
- source/document change monitoring;
- model maintenance/recalculation where permitted;
- reminders and task workflows.

Devices are clients for status, notification, review and permission-bound intervention. Closing the desktop UI must not necessarily kill a Home-hosted automation when Home is configured to remain running.

Continuing workflows must re-check permissions, source rights and consequential-action authorization when they resume or act.

## 10. Multi-device delivery sequence

Multi-device productization is the centerpiece of SI-06, but its secure foundation should be preserved during earlier integration work.

### M1 — Device foundation hardening

- audit/reuse existing `DeviceNetwork`, Home identity, discovery, pinned socket and Gateway paths;
- complete pairing lifecycle, device inventory, revocation and permission binding;
- add user-visible Home/device status and failure truth;
- prove restart/reconnect and identity continuity.

### M2 — Second-desktop journey

Prove the full architecture with the least UI-platform complexity first:

> Desktop A hosts Home → Desktop B pairs → B can open an authorized Project/Chat/Artifact → B performs a safe version-bound change → A observes the canonical result → revoke B → B can no longer access Home.

This is the foundational multi-device MSJ before mobile work.

### M3 — Remote connectivity

Prove the same paired-device relationship outside the LAN through a user-controlled remote connectivity path. No new content authority is introduced.

### M4 — Continuity and offline cache

Add selected-Project caching, revision reconciliation, explicit conflict handling and offline truth rules.

### M5 — Mobile companion

Deliver chat/voice, Project/Artifact access, alerts, status, capture/upload and approval flows backed by Home.

### M6 — Tablet workspace

Expand the companion model for professional review/editing workflows.

### M7 — Watch/minimal companion

Add notifications and very constrained approval/status interactions only after the underlying digest-bound approval semantics are already proven.

## 11. SP-06 Autonomous LiOS Beta

Recommended SP-06 flagship journey:

1. User begins a governed research/finance workflow on Desktop/Home.
2. Home persists the Project, evidence and Artifact state.
3. A Home-hosted monitor detects a permitted real change and produces a notification.
4. User receives the notification on a paired mobile device away from the LAN.
5. User asks what changed; the request is executed through Home using the configured BYOAI/provider stack.
6. LiOS returns dated evidence, explicit truth/freshness state and a proposed Artifact/Decision revision.
7. User approves or rejects the exact bound operation from mobile where policy permits.
8. Desktop later opens the same Project and sees the canonical updated state and receipts.
9. Selected cached material remains explicitly readable offline without pretending Home/provider freshness.
10. Reconnect reconciles revisions safely.
11. Device revocation is demonstrated and access fails afterward.

SP-06 requires packaged/target proof, continuity/restart evidence, notification truth, permission re-check evidence and protected regression of accepted prior Shipping Points.

## 12. SI-07 product convergence

SI-07 is where the underlying breadth becomes one product.

The UX should converge on a small user vocabulary:

> **Ask → Research → Calculate → Create → Monitor → Act**

The authenticated shell remains the coherent access point for:

- New Chat / Search;
- Projects / Chats;
- Library / Artifacts;
- Automations;
- Plugins / Connectors;
- Settings;
- Home & Devices;
- account/profile.

Old overlapping mental models such as multiple competing workspace/workbench shells must not reappear.

SI-07 also closes:

- zero-setup first-run/onboarding;
- choose/confirm this device as Home;
- move/restore Home;
- device pairing/revocation UX;
- BYOAI/provider setup;
- connector health;
- Doctor/repair;
- updates/rollback;
- backup/restore;
- performance and resource bounds;
- accessibility;
- complete empty/loading/error/offline/degraded states;
- production visual polish.

## 13. Packaging and Home lifecycle

The default single-device installation must remain simple:

> Install LiOS → sign in → local Home starts → create/open Project.

Advanced infrastructure is opt-in.

The product must eventually support explicit Home lifecycle operations:

- make this device Home;
- show Home health/identity;
- pair a device;
- revoke a device;
- back up Home;
- restore Home;
- move Home to another user-owned machine;
- verify that a restored/moved Home does not accidentally create two writable authorities for the same identity.

The exact move/restore protocol belongs in the implementation plan and may require a dedicated bounded/architectural follow-up if current backup authority is insufficient.

## 14. Validation strategy

Apply the canonical progressive-validation contract:

- **V0:** static/direct/local checks during coding;
- **V1:** focused task gate for every meaningful bounded change;
- **V2:** shared-core/device/Gateway/sync/security integration checkpoints;
- **V3:** SP-05, SP-06 and SP-07 shipping gates using the real packaged targets and flagship journeys;
- **V4:** final cross-platform, signing/notarization, clean-machine, upgrade/rollback, backup/restore and P14 qualification.

Heavy full-suite runs remain deliberate. The self-hosted Mac remains primary where faithful, while hosted minutes are reserved for release targets the Mac cannot prove.

## 15. Explicit v1 non-goals

To finish rather than expand indefinitely, v1 does not require:

- a Limuria-hosted normal customer intelligence/data runtime;
- generic cloud sync of every Project/file/secret;
- full arbitrary peer-to-peer multi-master state;
- CRDT conversion of every data type;
- full desktop feature parity on mobile/watch;
- autonomous real-money brokerage by default;
- silent background permission bypass;
- fake offline freshness;
- installing all 92 donors simply to claim adoption;
- a second Gateway/device/store/permission/Artifact/finance authority.

## 16. Risks and mitigations

### Integration debt outruns implementation
**Mitigation:** F1 is a hard convergence block; shared-core owners serialize; temporary evidence PRs close after use.

### Multi-device creates a second product architecture
**Mitigation:** reuse existing Home/Gateway/Project/Artifact/permission authorities; devices are clients, not new authorities.

### Sync becomes an endless CRDT project
**Mitigation:** Home-authoritative, version-bound writes and explicit conflicts for v1.

### Remote access weakens local-first security
**Mitigation:** opt-in networking, stable cryptographic Home identity, explicit pairing, revocation, least scope, current permission re-check and fail-closed transport identity.

### Mobile accidentally becomes a secret/data replica
**Mitigation:** bounded encrypted cache with explicit replication policy; invoke connectors/models through Home where possible.

### Automations act on stale authority
**Mitigation:** re-check permissions, source rights, operation digest and relevant freshness immediately before consequential execution.

### Shipping is postponed by continuous capability expansion
**Mitigation:** SP-05, SP-06 and SP-07 are mandatory finish gates; new breadth must justify contribution to those journeys.

## 17. Acceptance criteria for the finish design

This design is accepted when the owner confirms all of the following:

1. The finish order is **F1 Consolidate → F2 Finish Intelligence → F3 SP-05 → F4 SI-06 Everywhere → F5 SI-07 Convergence → F6 Release**.
2. LiOS Home remains the normal user-owned runtime authority.
3. Limuria's control plane does not become the normal customer intelligence/data plane.
4. Existing device/Gateway authorities are reused rather than duplicated.
5. Home-authoritative sync/version reconciliation is sufficient for v1; universal CRDT is not required.
6. Second-desktop proof precedes mobile/tablet/watch expansion.
7. Remote connectivity is user-owned/private-first; any future Limuria rendezvous remains content-blind by design.
8. Offline mode is bounded and explicit about stale/unavailable capabilities.
9. Automations live with Home and devices act as governed clients.
10. SP-05/SP-06/SP-07 and V3/V4/P14, not capability count, define completion.

## 18. First implementation program after approval

After owner approval of this written design, create the implementation plan according to the repository's Superpowers workflow.

The first implementation epic should be **F1 — Integration Consolidation**, because shipping and SI-06 cannot safely build on a fragmented current-main state.

F1 should begin by refreshing `main` and enumerating a dependency-ordered integration queue covering at minimum:

- the paper-action tenant-boundary repair;
- observed-quote V2 diagnosis/repair;
- current P11 shared-seam owner/integration;
- rebasing/qualifying SI-05.06 and SI-05.11 on current `main`;
- closing evidence-only temporary PRs;
- reconciling #554/control truth;
- determining which remaining SI-05 feature branches belong before SP-05 versus after it.

A non-conflicting M1 read-only/device-foundation audit may run in parallel, but new device product code should begin only after the implementation plan identifies the exact canonical owners and high-conflict files.
