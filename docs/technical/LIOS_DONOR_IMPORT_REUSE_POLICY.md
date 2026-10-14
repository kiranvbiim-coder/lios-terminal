# LiOS Donor Import, Reuse & Creative Adaptation Policy

**Status:** Canonical repository-wide policy  
**Applies to:** All contributors, coding agents, automations, workstreams, issues and pull requests  
**Ownership:** Agent-independent; this policy assigns no ownership or responsibility to any specific agent

## 1. Purpose

This policy defines the repository-wide rules for evaluating, importing, reusing, modifying, combining, adapting, and maintaining code or implementation ideas obtained from approved external donor projects.

The objective is to accelerate LiOS development by making intelligent use of proven implementations while preserving LiOS as the final product, architecture, user experience, and source of authority.

This policy is **agent-independent**. It applies equally to every current or future contributor, coding agent, automation, or development workflow.

It assigns no responsibility or ownership to any particular agent.

## 2. Core Principle

**LiOS owns the product. Donors provide implementation leverage.**

External donor projects may supply mature code, algorithms, components, workflows, infrastructure, protocols, utilities, or implementation patterns.

They must not automatically define LiOS architecture, product concepts, naming, user experience, data ownership, or system authority.

Where LiOS already has an established architectural authority, donor implementation must integrate with that authority rather than compete with or replace it unintentionally.

## 3. Reuse Before Rewrite

When an approved donor already contains a mature implementation relevant to a LiOS requirement, contributors must evaluate reuse before creating a new implementation.

The preferred decision sequence is:

> **INSPECT → REUSE / IMPORT → ADAPT → MODIFY → COMBINE → WRAP → EXTEND / INNOVATE → BUILD NEW LAST**

Building equivalent functionality entirely from scratch should normally be the final option rather than the default.

A rewrite is justified only when reuse would materially harm architecture, maintainability, security, licensing compliance, performance, product requirements, or long-term development quality.

The objective is not maximum copying.

The objective is **maximum useful leverage with minimum unnecessary reinvention**.

## 4. Creative Adaptation Principle

A donor implementation must **not be rejected merely because it does not fit LiOS exactly in its original form**.

Before deciding that donor code is unusable, contributors must determine whether its valuable parts can be made useful through intelligent adaptation.

This may include:

- modifying the implementation;
- extracting only the useful subsystem or algorithm;
- simplifying donor-specific abstractions;
- removing unnecessary dependencies;
- replacing donor assumptions with LiOS concepts;
- wrapping donor functionality behind an existing LiOS interface;
- combining useful portions from more than one approved implementation;
- extending the donor implementation to support LiOS requirements;
- changing internal structure while preserving proven mechanics;
- separating reusable mechanics from donor-specific product logic;
- integrating donor capabilities into an existing LiOS authority;
- redesigning the surrounding integration while retaining the strongest underlying implementation.

Contributors are therefore expected to apply engineering judgment and creativity rather than making a binary decision between **"copy exactly"** and **"do not use."**

The preferred question is:

> **What is valuable in this implementation, and how can it be transformed to fit LiOS correctly?**

rather than:

> **Can this donor implementation be copied exactly as it is?**

## 5. Preserve the Valuable Part, Not Necessarily the Donor Structure

The reusable value of a donor may exist at different levels.

It may be:

- an entire subsystem;
- a package;
- a service;
- a component;
- an algorithm;
- a protocol implementation;
- an execution pattern;
- a parser;
- a synchronization mechanism;
- a recovery mechanism;
- an error-handling strategy;
- a UI interaction;
- a state-management technique;
- or another mature implementation detail.

Contributors should preserve whatever provides genuine engineering value while remaining free to restructure the implementation around LiOS requirements.

A donor's original directory structure, abstractions, naming system, dependency graph, product model, or architectural boundaries do **not** need to be preserved unless they are themselves beneficial to LiOS.

## 6. LiOS Architectural Authority

Existing LiOS architectural authorities remain canonical.

Donor reuse must not casually introduce a second or competing:

- router;
- runtime;
- store;
- database authority;
- context system;
- memory authority;
- Artifact authority;
- Project authority;
- Conversation authority;
- entity authority;
- engine authority;
- permission system;
- authentication authority;
- configuration authority;
- persistence authority;
- or other equivalent system of record.

When LiOS already owns a concept, donor mechanics should normally operate **inside, underneath, through, or behind** that LiOS authority.

A useful donor subsystem should be adapted to LiOS architecture rather than forcing LiOS architecture to imitate the donor unnecessarily.

## 7. Integration Before Duplication

The preferred outcome of donor reuse is a stronger existing LiOS system, not an additional parallel system.

Before introducing a new architectural abstraction, contributors must determine whether the donor capability can be:

> **INTEGRATED → WRAPPED → ADAPTED → MERGED → INCORPORATED**

into an existing LiOS path.

Duplicating an existing authority simply because the donor already contains its own version is not acceptable.

## 8. Full Reuse Is Allowed

Where technically appropriate and legally permitted, LiOS may reuse substantial donor implementations rather than recreating them manually.

This may include copying and then modifying complete useful packages, modules, components, or subsystems.

There is no requirement to rewrite working donor code merely to make the implementation appear independently written.

Engineering effort should instead be spent where it creates actual LiOS value: integration, product differentiation, architecture, reliability, usability, intelligence, and new capabilities.

## 9. Modification Is Expected

Imported donor code is not required to remain identical to its upstream implementation.

Once selected for LiOS use, it may be:

- renamed;
- reorganized;
- refactored;
- reduced;
- extended;
- optimized;
- integrated;
- decomposed;
- combined with LiOS code;
- combined with other approved donor implementations;
- or rewritten partially where necessary.

The goal is to obtain the strongest LiOS implementation, not to preserve donor structure for its own sake.

## 10. Avoid Blind Imports

Aggressive reuse does not mean indiscriminate copying.

Contributors must avoid importing:

- unused donor infrastructure;
- unnecessary dependencies;
- donor-specific product assumptions;
- obsolete compatibility layers;
- redundant abstractions;
- duplicate architectural authorities;
- unrelated features;
- unnecessary build complexity;
- or code that creates avoidable long-term maintenance burden.

Import the **useful capability**, together with whatever supporting code is genuinely required.

## 11. LiOS Product Identity

LiOS remains the product-facing identity.

User-facing terminology, UX, interfaces, product behavior, documentation, commands, and concepts should follow LiOS design and naming unless technical compatibility requires otherwise.

Donor terminology should not leak into the product simply because it existed in the source implementation.

Internal implementation lineage and legal attribution are separate matters and must be preserved where required.

## 12. Provenance and Licensing

All donor reuse must respect the applicable license and legal requirements.

Required copyright notices, license notices, attribution, and other mandatory provenance must not be removed merely to make imported code appear native to LiOS.

For significant donor reuse, sufficient provenance should be retained to identify, where practical:

- donor repository;
- upstream source;
- source version, tag, or commit;
- original component or path;
- applicable license;
- LiOS destination;
- and significant LiOS modifications.

LiOS branding does not override legal attribution obligations.

## 13. Prefer Stable Integration Boundaries

Where practical, donor implementation should be isolated behind stable LiOS interfaces.

This allows LiOS to benefit from mature external implementation while retaining control over:

- product contracts;
- architecture;
- data models;
- permissions;
- UX;
- state ownership;
- and future replacement or refactoring.

The donor should therefore provide implementation power without becoming an uncontrolled architectural dependency.

## 14. Improve During Adoption

Donor reuse should not be treated as archival copying.

When integrating donor code, contributors may improve it where there is a clear engineering benefit.

Examples include:

- stronger typing;
- improved error handling;
- better observability;
- simplified abstractions;
- security improvements;
- reduced dependency footprint;
- improved tests;
- better performance;
- clearer boundaries;
- accessibility improvements;
- or deeper integration with LiOS capabilities.

The target is not merely **donor parity**.

Where practical, the target is:

> **Donor capability + LiOS integration + LiOS improvements**

## 15. Do Not Abandon Good Ideas Because Integration Is Difficult

Integration difficulty alone is not sufficient reason to discard a strong donor capability.

If an implementation contains substantial value but conflicts with LiOS structure, contributors should first investigate whether the conflict can be resolved through:

- decomposition;
- wrapping;
- interface adaptation;
- data-model translation;
- dependency substitution;
- selective extraction;
- refactoring;
- partial adoption;
- or another technically sound integration method.

A valuable implementation should only be rejected after reasonable adaptation paths have been considered.

## 16. Build From Scratch When It Creates Real Value

New LiOS-native implementation is appropriate when:

- no suitable donor implementation exists;
- donor quality is inadequate;
- licensing prevents appropriate reuse;
- the donor architecture is fundamentally incompatible;
- security or reliability requirements cannot be satisfied through adaptation;
- adaptation would be more expensive or fragile than a clean implementation;
- LiOS requires materially different behavior;
- or LiOS innovation requires functionality that donors do not provide.

New implementation should therefore be a deliberate engineering decision, not an automatic preference.

## 17. Innovation Beyond Donors

Donors represent useful starting points, not the ceiling of LiOS capability.

Contributors should actively identify opportunities where LiOS can:

- improve donor implementations;
- combine strengths from multiple sources;
- remove weaknesses;
- simplify unnecessarily complex systems;
- create better integrations;
- introduce new capabilities;
- or develop approaches that donors do not currently provide.

The purpose of donor reuse is to avoid wasting effort rebuilding solved problems so that more effort can be invested in areas where LiOS can genuinely differentiate and innovate.

## 18. No Automatic Upstream Authority

A donor repository changing upstream does not automatically require LiOS to follow that change.

Once donor code has been integrated, LiOS remains responsible for deciding whether later upstream changes should be:

- adopted;
- adapted;
- selectively merged;
- ignored;
- or replaced by a LiOS implementation.

LiOS requirements take precedence over maintaining artificial synchronization with a donor.

## 19. Ambiguity Rule

When this policy does not explicitly resolve a situation, contributors should use the following default:

> **Preserve existing LiOS architecture, extract the greatest practical value from approved donor implementations, avoid unnecessary duplication, and choose the solution that produces the strongest maintainable LiOS implementation.**

Ambiguity must not automatically result in either:

> **rewrite everything**

or

> **copy everything**

Engineering judgment should be applied within the principles of this policy.

## 20. Policy Precedence and Amendment

This document is the canonical repository-wide donor import, reuse and creative-adaptation policy.

Individual task descriptions, temporary prompts, implementation preferences, agent assumptions, issue comments, or pull-request comments must not silently redefine the donor reuse strategy.

Where an instruction appears to conflict with this policy, implementation must follow this policy unless the policy itself has been intentionally amended.

Any material change to this policy must therefore be explicit, deliberate, reviewable, and committed as a policy change rather than emerging accidentally during implementation.

## 21. Owner clarification — selection, package scope and evidence

The following rules resolve the policy choices recorded by the owner on 2026-10-05.

### 21.1 OpenClaw preference is default and rebuttable

For a capability that OpenClaw implements, inspect OpenClaw first and prefer it when it can satisfy LiOS requirements after reasonable adaptation. Another approved donor may be selected when a documented comparison shows a materially better result in capability, security, reliability, maintainability, licensing, footprint, performance, packaging or LiOS integration fit. OpenClaw preference must not force an inferior implementation or weaken a canonical LiOS boundary.

### 21.2 Import the whole useful package minus exclusions

The preferred reuse unit is the complete coherent package or subsystem, not an arbitrarily small function extraction. Import the whole useful package, then remove only material paths that are unused, unrelated, unsafe, unsupported, legally blocked, unmaintainable or competing with canonical LiOS authority.

When the useful capability spans packages, a coherent cross-package capability slice is allowed. Every material excluded donor path or subsystem must receive a path-level disposition and a concrete reason such as duplicate authority, unused scope, unsafe behavior, unverified rights, unsupported platform, replaced dependency or defer-with-trigger.

### 21.3 Replace authority seams; retain mechanics

If a selected package contains its own identity, permission, persistence, journal, execution, Artifact, entity, engine, skill/plugin or product authority, retain its useful mechanics but replace those seams with the corresponding canonical LiOS authority. A donor package must not create a parallel authority merely because its upstream product includes one.

### 21.4 Modify freely while preserving provenance

Imported code may be renamed, moved, reduced, extended, optimized, combined, dependency-substituted and otherwise changed to produce the strongest LiOS implementation. Preserve the donor repository, approved pin, original paths, LiOS destination paths, applicable license/notices and material modification record.

Use a hybrid source layout:

- keep mostly unchanged donor internals under an identifiable donor/version namespace where that improves provenance, updates or test portability;
- place heavily adapted authority boundaries and product integration in canonical LiOS directories with explicit upstream mappings.

### 21.5 Decompose and substitute dependency closures

A broad dependency closure is not automatic rejection evidence. Identify the dependencies required by the useful package, retain verified essential dependencies, remove unrelated product dependencies and substitute existing LiOS facilities for duplicate or risky dependencies where appropriate. Record every retained, removed and replaced material dependency.

### 21.6 Cross-donor composition is permitted

LiOS may combine complementary implementations and mechanisms from multiple approved donors behind one canonical LiOS contract and authority. Preserve separate source, license and modification evidence for each donor. The result must be one coherent LiOS capability, not parallel donor product paths.

### 21.7 Rejection requires documented comparison

Before building a replacement, inspect the complete useful subsystem and applicable upstream tests, then evaluate direct import, package-minus-exclusions, authority-seam replacement, dependency substitution, wrapping, adaptation and cross-donor combination. Rejection must cite concrete licensing, security, quality, maintenance, platform, performance, dependency or architectural evidence. Original domain, imperfect fit or integration difficulty alone is insufficient.

### 21.8 Incomplete rights block distribution, not analysis

If license or redistribution evidence is incomplete, do not package, redistribute or claim shipping readiness for the affected source or artifact. Continue source analysis, boundary design and search for verified rights or alternatives where legally permitted. Source availability is neither automatic permission nor automatic rejection.

### 21.9 Port applicable upstream tests

Bring over tests applicable to imported behavior, preserve their lineage, adapt runners and fixtures without weakening assertions, and add LiOS authority, security, cancellation, restart, unavailable-state, idempotency, receipt and packaged/target tests as appropriate. Tests for excluded paths may be omitted only with the same explicit exclusion record.

### 21.10 Significant imports require a full evidence bundle

Record:

- repository, approved pin, source paths and hashes where appropriate;
- license, copyright and notices;
- imported and destination paths;
- path-level exclusions;
- retained, removed and substituted dependencies;
- authority substitutions and material modifications;
- applicable upstream tests and LiOS boundary tests;
- integration and packaged/target evidence where the capability claim depends on it;
- supported platforms, unavailable states, limitations and next qualification dependency.

### 21.11 Curated upstream updates

Track upstream pins and diffs. Selectively adopt security fixes, bug fixes, compatibility changes, performance improvements and useful capabilities after LiOS compatibility, license, dependency and test review. Do not automatically ingest upstream releases or surrender LiOS authority to upstream architectural changes.

### 21.12 Core installer and large assets

Every approved donor package and runtime codebase belongs in the standard LiOS installation with its pins, manifests, health checks, verification and rollback support. Users must not perform manual dependency installation.

Exceptionally large payloads—such as model weights, browser binaries, large native runtimes, document/vision packs or licensed datasets—may be installed through the same LiOS installer/provisioning experience as consented payloads. Before installation, disclose size, source, purpose, storage impact, platform and verified rights status. This is one LiOS installation lifecycle, not a user-managed dependency path.

### 21.13 Approval threshold

A donor package is approved only when its exact source pin, rights, package boundary, authority substitutions, dependency closure, path-level exclusions, applicable tests, integration design, platform support and explicit unavailable states are recorded. Approval of package code does not itself qualify every large binary asset for distribution.

## Governing Rule

> **Reuse what is proven.**  
> **Adapt what does not fit directly.**  
> **Combine what creates a stronger solution.**  
> **Improve where LiOS can do better.**  
> **Build new only where doing so adds real value.**  
> **Preserve LiOS architectural authority throughout.**

The purpose of donor reuse is not to copy another product and not to unnecessarily rewrite mature engineering.

The purpose is to intelligently transform proven implementation into the strongest possible LiOS system.

## 22. Owner clarification — Exhaustive Donor & Fork Harvesting (2026-10-12)

This section strengthens the existing donor-first rule. It creates no new architecture, workstream, donor registry or product authority.

The mandatory implementation sequence for substantial capability work is now:

> **DISCOVER → SOURCE-AUDIT → DECOMPOSE → FORK-MINE → REUSE → IMPORT → ADAPT → REPURPOSE → COMBINE → GENERALIZE → IMPROVE → PORT TESTS → PACKAGE → BUILD ONLY THE REMAINDER**

### 22.1 Coherent useful-package source audit

README, metadata, top-level architecture or repository-name review does not establish a complete donor audit. When a donor is selected for active capability work, contributors must inspect the complete coherent useful package or cross-package capability slice: source paths, utilities, algorithms, state machines, adapters, recovery, caching/scheduling/checkpointing/replay, security/permissions, persistence/synchronization, platform code, examples, tests/fixtures, dependency closure, optional/heavy assets and legal boundaries.

Machine audit states are defined by `third_party/donor-harvesting-controls.json`:

- `not_started`
- `metadata_reviewed`
- `partial_source_audit`
- `full_useful_package_audit`

`full_useful_package_audit` may be claimed only when every identified material path, meaningful mechanism and applicable upstream-test group has an evidence-backed disposition.

### 22.2 Path and mechanism disposition

Material donor paths and mechanisms must not disappear into a binary import/reject decision. Applicable dispositions include direct reuse, import, adaptation, repurposing, combination, generalization, innovation, reference validation, defer-with-trigger, explicit authority/unused/rights/security/platform exclusions and reject-with-evidence.

Rejecting the donor product does not reject every useful internal mechanism. Overlapping, deferred or rejected donors may still contribute a legal, safe mechanism, validator, test, algorithm, recovery pattern or comparison benchmark behind the canonical LiOS owner.

### 22.3 Fork-delta mining

For high-value donors where forks are material, inspect the controlled LiOS fork/mirror and screen meaningful upstream/community deltas for security fixes, platform support, packaging, dependency simplification, recovery/checkpoint improvements, performance, algorithms, tests, protocol compatibility and bug fixes.

Fork review states are:

- `not_applicable`
- `controlled_fork_reviewed`
- `ecosystem_screened`
- `material_forks_deep_reviewed`

A fork HEAD is observation evidence only. It is never an approved LiOS source pin, rights grant, import, packaged runtime or Shipping Point claim. Community-fork code becomes adoptable only after exact repository/commit/path rights, provenance, canonical owner, dependency closure, tests and LiOS destination are recorded through existing component/pin/evidence mechanisms.

### 22.4 Cross-donor composition is expected where it is stronger

A capability audit must consider whether complementary donors can produce a better LiOS result than selecting one upstream winner. One donor may supply planning, another evidence retrieval, another parsing/recovery, another rendering, while P4/P5/P11/GM retain their canonical authorities.

Cross-donor composition must converge into one LiOS capability contract. It must not expose parallel donor products, stores, routers, permission systems, engines or agent stacks.

### 22.5 Upstream tests are reusable engineering assets

Applicable upstream tests must be reviewed alongside adopted code/mechanisms. Port applicable tests with lineage, retain or strengthen assertions, adapt fixtures/runners to LiOS and add authority/security/cancellation/restart/unavailable-state/provenance/known-answer/packaged-target coverage where relevant.

Ignoring mature applicable upstream tests requires an explicit exclusion reason. A deep-harvesting claim requires 100% disposition of identified applicable upstream test groups; this does not require porting tests for excluded paths.

### 22.6 Donor Exhaustion Record before substantial scratch-build work

A substantial commodity capability must not be declared donor-exhausted or justify a scratch-built replacement without a **Donor Exhaustion Record**.

The record must state, as applicable:

- relevant donors inspected;
- controlled forks inspected;
- material community-fork screening;
- complete useful package/source paths inspected;
- applicable upstream tests inspected;
- direct import/package-minus-exclusions considered;
- canonical authority-seam replacement considered;
- dependency substitution/wrapping/adaptation/repurposing considered;
- cross-donor composition considered;
- the exact LiOS-native remainder to build;
- the concrete reason that remainder should be LiOS-native.

The following are not sufficient on their own: **easier to rewrite; different domain; not designed for LiOS; integration is difficult.**

Valid build-new reasons remain evidence based: no suitable donor mechanism, incompatible rights, uncorrectable security/reliability issue, an authority conflict that cannot be isolated, materially worse adaptation cost/fragility, genuinely novel LiOS behavior, or demonstrated performance/platform/footprint inferiority.

### 22.7 Machine enforcement and truth boundaries

`third_party/donor-harvesting-controls.json` defines the control vocabulary only; it is not a second donor registry. Donor identity and implementation truth remain in the existing canonical third-party ledgers.

`src/script/validate_universal_donor_adoption.mjs` must fail promotion claims when:

- a full useful-package audit has undispositioned material paths/mechanisms/tests;
- donor exhaustion lacks the required record;
- a forbidden shortcut is used as the scratch-build reason;
- a controlled fork has no explicit delta-review state/provenance gate/next trigger;
- fork observation is promoted to import without canonical source evidence;
- baseline donor/fork counts or identities drift;
- harvesting metrics imply shipping or integration beyond canonical truth.

Controlled-fork evidence evolves more frequently than donor identity. Therefore fork identity and evidence are validated directly against `third_party/controlled-fork-utilization.json`; the frozen donor/component/upstream-pin registries retain strict snapshot checks. This avoids treating legitimate fork-delta evidence updates as donor-identity changes.

### 22.8 Utilization metrics are evidence metrics, not installation quotas

Do not optimize for "92 donors installed." Track:

- Source Audit Coverage;
- Mechanism Disposition Coverage;
- Path Disposition Coverage;
- Test Harvest Coverage;
- Fork Review Coverage;
- actual Reuse Leverage versus newly built commodity equivalents.

A completed active donor audit requires 100% disposition of identified material paths, meaningful mechanisms and applicable upstream-test groups. Reuse Leverage is diagnostic, not a quota that forces an inferior import.

### 22.9 Execution integration

Exhaustive harvesting remains inside existing SI/GM/TC/CA/P ownership and Shipping Point execution. It does not create another roadmap. Every substantial issue/PR records its donor/fork analysis and, when scratch-building a remainder, the Donor Exhaustion Record. The 92 baseline remains frozen for accounting and the 10 controlled forks remain separately accounted unless deliberately amended through canonical evidence.

### 22.10 Final harvesting rule

> **Harvest proven implementation as deeply as practical. Mine useful fork deltas. Combine complementary donors. Preserve canonical LiOS authorities. Port useful upstream tests. Build only the LiOS-specific remainder after evidence-backed exhaustion.**
