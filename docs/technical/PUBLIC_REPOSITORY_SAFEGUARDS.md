# Public Repository Safeguards — LiOS Terminal

**Date:** 2026-10-14
**Repository:** https://github.com/kiranvbiim-coder/lios-terminal
**Scope:** public source distribution, SI-01 through SI-07, imported donors/forks, contributors, native packaging and user-owned runtimes.

This is an owner and agent execution checklist, **not** a security certification or permission to ship. Current source CI validates source behavior only; packaged Shipping Point and release qualification remain separate.

## Safeguarding boundaries

1. **Intellectual property and rights:** Public availability is not confidentiality. Original LiOS material is proprietary per the root LICENSE; applicable third-party licenses still control donor code. Never republish private development history, non-redistributable datasets, provider responses, model weights, brand assets or customer material. Maintain THIRD_PARTY_NOTICES.md, third_party manifests, per-path provenance and exact copied-package obligations.
2. **Customer and product trust:** Keep customer data, vaults, signing keys, provider credentials and local Home state on user-owned infrastructure. Enforce authorization, tenant isolation, exact-operation approvals, egress/SSRF checks, sandbox boundaries, audit receipts, rollback and secrets redaction in the runtime—not merely the UI. Privileged interactive exec and brokerage actions remain blocked until their canonical acceptance gates are proven.
3. **Supply chain:** Changes to npm, Python, vendored archives, controlled forks, CI actions or native pack content require licenses, exact versions/hashes, adverse-advisory checks and reproducible tests. Dependabot's weekly update PRs are **review-only**; generated PRs do not prove compatibility or release rights.
4. **GitHub permissions:** Default to least privilege. A contributor PR never receives production/provider/signing secrets, self-hosted runner access, write-capable tokens or trusted release privileges. Avoid pull_request_target and workflow_run privilege escalation in this public source repository.
5. **Availability and recovery:** Keep separately secured, encrypted, access-limited backups of source refs, issue/PR metadata and essential release/rights records. Periodically test restore into a separate private recovery environment. Do not use public Actions artifacts, the public repo or end-user data stores as backups.

## Implemented in repository source

- Main has hosted Linux/macOS/Windows CI and a read-only workflow token, without signing/deployment.
- A deterministic public-source guard fails on tracked key/vault/runtime-db files, non-template environment files, symlinks, missing publication controls and explicit privileged CI patterns. It runs in each existing required platform job; negative-case tests protect the guard.
- CODEOWNERS covers critical security, workflow, packaging and rights paths. **Code-owner text only becomes enforcement after the GitHub repository setting is enabled and compatible with available reviewers.**
- A PR template requires public-source, donor-rights and trust-boundary attestations; a Dependabot config requests npm/Python/GitHub Actions updates for review.
- Existing LICENSE, SECURITY.md, notices and canonical validation contracts remain in force.

This guard intentionally **does not** prove code free of hard-coded secrets, sanitize existing history, scan GitHub issues/PRs/Actions artifacts, certify third-party rights or authorize shipping. It must be complemented by native GitHub scanning and independent release review.

## GitHub owner/operator settings — verify manually

The GitHub connector cannot confirm all repository administration settings, and branch protection detail currently returns an integration permission error. Do **not** claim any of these enabled without observing the live settings.

- [ ] Settings > General: only trusted maintainers have write/admin access; disable unused features and unsafe fork/Actions defaults.
- [ ] Settings > Branches / Rules: require a PR to main, required passing current-head Linux/macOS/Windows checks, no force-push/deletion, stale-approval dismissal, resolution of review comments and code-owner review. Remove bypasses for admins where feasible. For a solo maintainer, arrange a second trusted reviewer rather than assuming an owner can approve their own PR. Require signed commits when the developer/CI signing workflow is prepared.
- [ ] Settings > Actions > General: restrict workflow permissions to read, require approvals for outside contributors, restrict Actions and reusable workflows to reviewed origins, restrict or eliminate self-hosted runners, and restrict which actors can approve/run workflows.
- [ ] Settings > Security / Code security and analysis: enable Dependabot alerts/security updates, secret scanning and push protection where available, and private vulnerability reporting (private advisories). Check whether code scanning/CodeQL is available and enable a tested default setup.
- [ ] Accounts and connected apps: require strong 2FA/passkeys, audit installations/collaborators/PAT scopes and rotate/revoke stale credentials. Use no production or signing secrets in public Actions.
- [ ] Public exposure audit: independently scan every public branch/tag and full reachable Git history; inspect issues, PR conversations, release assets, retained Actions logs/artifacts, commit author metadata and uploaded assets for sensitive or unauthorized material. Review separately: original private repo must not be opened or copied wholesale. Treat a negative path check as **insufficient**.
- [ ] If a real credential was exposed: **revoke/rotate first**, contain access and report privately; then arrange an owner-approved remediation plan for public history and surfaces. Never silently rewrite history or force-push.
- [ ] Maintain encrypted off-site backups; test restore and incident-response contacts quarterly. Document recovery ownership without publishing credentials or private restore locations.
- [ ] Before every signed release: complete the exact P14 / Shipping Point gates; test installed native artifacts, code signing, update integrity, full runtime dependency graphs, tenant denial tests, agent/sandbox escape boundaries and external security evidence.

## Next engineering passes

- [ ] Review ongoing hosted source failures before merging any source or security PR.
- [ ] Run history-aware secret scanning with a vetted tool plus independent GitHub secret scanning; handle any discovered values privately.
- [ ] Add reviewed dependency and static-analysis gates with clear false-positive/exception handling; avoid hardcoded credentials in test fixtures.
- [ ] Audit native updater, sandbox, agent tools, browser/computer use, connectors, finance calculations and tenant data paths against the canonical P13/GM-11/P14 security test matrices.
- [ ] Verify each donor/fork file's provenance, modifications, license, NOTICE, asset/data rights and copied native-package inclusion before release.
- [ ] Record real evidence against exact commits. A merged PR, passing source CI or policy document is not acceptance.

**Escalation:** Follow SECURITY.md for private reports. Do not place exploitable vulnerability details, access tokens, personal data or production configuration in public issues or pull requests.
