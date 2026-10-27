# LiOS Website Assimilation C2 — Reviewed P11 Calculation to P4 Artifact

**27 October 2026** · [Master website integration tracker #258](https://github.com/kiranvbiim-coder/lios-terminal/issues/258) · C2 on C1 #286 → B3 #281 → B2 #277 → B1 #274 → A4 #270 → A3 #266 → A2 #263 → A1 #261 → #253.

## Code owner audit: do not rebuild already-existing engine/save

The real `IntegratedModelStudioPanel` already executes **P11's deterministic, point-in-time integrated financial model**, records a persisted `receipt` and exposes manual Save to an exact selected Project or persistent Chat. Its existing `saveIntegratedModelRunArtifact(runId,destination)` sends to the authorized P4 server, where `readIntegratedModelRun` and `retainIntegratedModelArtifact` recompute hashes and source entitlement from the **current** persisted run/dataset, write the same immutable spreadsheet projection, and offer the existing canonical Artifact sidecar.

The missing journey was not another calculator or a new Artifact database. It was **an explicit pre-save user review** covering a completed run's source hashes **and destination together**, followed by an independently checked run receipt and a verifiable saved P4 workbook.

## Implemented C2

1. `client/src/lib/reviewedModelRunArtifact.ts` defines a pure, bounded identity for one P11 completed run: UUID run and dataset snapshot, SHA-256 result/dataset/input (when recorded), deterministic true, exact matching snapshot, passed accounting and circularity checks, **one valid Project or Chat destination**. Review identity changes on any captured run/hash/input/destination change.
2. `IntegratedModelStudioPanel.tsx` now shows a concise **Review the completed calculation before saving** panel inside the already-existing Save section, disclosing full run ID, result hash, dataset snapshot ID/hash, input hash when available, chosen destination, convergence/results, and the distinction between **last executed work vs unsent edited assumptions**. The user must explicitly click **Confirm this receipt and destination** before Save becomes enabled. It never auto-executes a fresh model or picks a destination.
3. On Save, the Studio calls the existing authenticated `GET /api/financial-models/integrated/runs/:runId`. That server already checks actor ownership, dataset access/admission, live entitlement policy and source revision and rehashes actual engine outputs. The UI additionally requires the fresh receipt to match the reviewed visible run **and** its original destination key to remain the active selection. Only then does it issue the existing authenticated P4 POST.
4. A server save response is verified, not simply taken as proof: original P4 identity/positive version, same destination, immutable spreadsheet kind, actual **P4 conversation-origin keeper** with an engine refreshSpec naming exactly the same run, and all four real persisted source references: `financial-model-run:`, `financial-model-result-sha256:`, `dataset-snapshot:`, `dataset-content-sha256:`. Only an exact match displays “saved vX” and adds it to current UI. Do not confuse P4's `origin:"conversation"` storage with the true **engine** refresh provenance.
5. If the run/destination/source/access changed between review and re-read, **no POST** is sent. A mismatched response after POST instead reports an **ambiguous save** and instructs the analyst to check the Library before retrying; it never falsely asserts rollback of server data. Existing prior successful Artifact remains openable. Saved review state is cleared after either save or failure, forcing a deliberate re-review.
6. All of this uses the existing P11 engine, P4 Artifact keeper, React UI and authenticated APIs. No synthetic outputs, third-party packages, purchase, paid CI minutes, image/UI imports, new workflow, second model runner, new Project role or database migration.

## Why this is the precise C2 slice

This is **integrated P11 model → P4** with real server receipt and frozen point-in-time inputs. The separate **P8 scenario-to-action pipeline** already produces its own `scenario-pipeline:sha256` candidate and advisory receipt; that path is not silently relabeled a P11 audited financial workbook or merged with these model results. P8 scenario approval is a different existing governance path. Any new multi-model universal composer will require distinct typed run sources, receipts, and permission checks. A pure front-end scenario-input comparison with no real engine run must never be described as a computed model result.

## Tests and acceptance

```bash
cd src
npm run test:website-c2
npm run check
npm run test:offline
npm run build
```

- `reviewedModelRunArtifact.test.ts`: immutable review identity; changes to run/output/input/dataset/destination; malformed/failed/nonconverged receipts denied; same owned Project/Chat, actual engine keeper/source refs, precise response mismatch.
- `websiteC2ReviewedModelIntegration.test.ts`: actual P11 Studio button, user-confirmed gating, fresh owned-run GET and P4 POST, real server snapshot rights/hash verification and no invented work.
- Existing `integratedModelArtifactSave.test.ts` and `integratedModelArtifact.test.ts` protect persistence/repeat and backend source lineage.
- `npm run test:website-c2` added to the same free/public Linux source validation workflow. **Do not claim the tests passed until CI reports success.**

### Still not accepted

Source implementation has been committed, but actual CI and native desktop acceptance (Mac ARM64/Win x64, offline/re-auth/revocation, 390px/768px/200% zoom, keyboard/screen reader, changing destination mid-request, native restart and permissions) remain required. The overall stack's inherited source/UX failures also need one consolidated integration gate. Source branch is a review candidate, not a released package.

## Next in #258

**C3**: explicit P7 evidence → observed consequence/decision investigation with grounded source chains and reviewable actions, not inferred causality. Then final stacked integration, green CI and installed release-readiness proof. Prioritize completing rather than opening another roadmap cycle.
