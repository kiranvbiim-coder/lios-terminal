# LIOS Security Policy

## Scope

This policy applies to LiOS Desktop Local / LiOS Home, user-owned server/cloud deployments, connectors, enterprise administration, diagnostics and the release pipeline. LiOS operates no normal customer intelligence/data runtime service. Distribution, commerce and signed-licence issuance are separate narrow services, not customer runtime or data custody.

## Development and release rule

Security changes use ordinary task branches and pull requests against `main`. V0/V1 focused checks and applicable V2 integration evidence are required under `docs/technical/LIOS_PROGRESSIVE_VALIDATION_CI_STRATEGY.md`; the complete V3/V4 hardening gate must be performed in the separate trusted release environment; it is not included in this public snapshot. Public hosted source CI does not replace packaged or release qualification.

No security-sensitive PR is merged while its applicable validation is failed, cancelled or still running.

## Security principles

1. Client organizations must never access another organization's data.
2. Internal-only functionality must not be reachable by client credentials, regardless of UI visibility.
3. Security controls are enforced server-side/main-process-side; frontend hiding is not authorization.
4. Customer BYOD files and databases remain under user/organization custody on Desktop Local or the selected user-owned Home/infrastructure.
5. Generic connectors must not become SSRF/private-network pivots or leak credentials through redirects; access to user-selected private infrastructure requires the governed connector authority, not unrestricted proxy access.
6. AI providers are not deterministic calculation engines and cannot grant themselves authorization, provider access or enterprise-policy exceptions.
7. Uploaded data is untrusted input and is bounded, normalized and content-validated before parsing.
8. Secrets are not returned by ordinary APIs or written unredacted to diagnostics/logs.
9. Team/enterprise tenant state on user-owned deployments uses tenant-scoped persistence and PostgreSQL RLS where applicable.
10. Authentication, CSRF, sessions, device authorization and enterprise SSO fail closed.
11. Retention/deletion/export controls and legal holds are explicit, auditable and do not centralize local export bytes.
12. Software-update and recovery paths preserve signed/hash-verified integrity.
13. External evidence is never fabricated from a unit test.
14. One web build, Home-owned `/api/auth/*` and one API authority serve role-gated access; separate audience bundles are not a security boundary.
15. Privileged interactive `exec.*` remains blocked until GM-11 exact-operation authority, sandbox and trust receipts are proven. No brokerage execution or copy trading is in current scope.
16. Shipping Points SP-01–SP-07 require real integrated journeys, target execution where applicable, explicit denied/unavailable states, regression protection and exact evidence under `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`; a security document does not establish acceptance.

## Reporting

Do not disclose suspected vulnerability details in a public issue. Contact the repository maintainers privately with the affected component, reproduction steps and potential impact. Do not include production credentials, customer data or private keys in a report.

## Public repository and contribution boundaries

- Before publication, audit every exposed branch/tag and Git history, plus issues, PR discussions, release assets and retained Actions logs/artifacts. A local source scan is not an audit of those other surfaces.
- Remove private data from the publication surface and rotate any real exposed credentials before remediation of history. History rewriting, deleting branches or changing visibility requires an explicit owner decision; do not silently force-push.
- Original LiOS source rights are stated in `LICENSE`; imported/adapted third-party material retains its separate licenses. Public visibility is not proof of redistribution rights for datasets, API content, model weights or branded assets.
- Public/fork pull requests use ephemeral standard GitHub-hosted runners with read-only tokens, no persisted checkout credentials and no production/signing/provider secrets. Do not use `pull_request_target` to execute contributor-controlled code.
- Restrict self-hosted runner access at GitHub runner-group/repository settings before making the repository public. Trusted maintainer workflow dispatch remains separate; a YAML condition alone cannot make arbitrary contributor code safe on a persistent machine.
- Require review for workflow/security changes and approval of external-contributor workflows. Do not put production secrets, customer databases, credential vaults or private documents into CI artifacts or logs.
- Report vulnerabilities privately through the repository's private security-reporting channel when enabled; otherwise contact maintainers privately. Do not test against another user's LiOS Home.

### Public distribution verification — not yet certified

- This public distribution starts from a sanitized source snapshot without the original private Git history, provider/academic dataset payloads, customer databases, credentials, installers, model weights or old CI/discussion exports.
- Shiller and provider-catalog observations require independently permitted local inputs; free download and connector licenses do not grant redistribution permission.
- There are no self-hosted runners or binary release workflows in this repository. Unprivileged Linux/macOS/Windows source CI contains no production/signing/provider secrets.
- CODEOWNERS declares workflow/security owners, and `main` reports protection with required source checks. Review requirements, bypass restrictions, external-contributor workflow approval and private vulnerability reporting must be independently confirmed in GitHub settings; do not infer their enforcement from source files.
- Source CI does not accept any Shipping Point or signed binary. Exact dependency-license obligations, copied-graph vulnerabilities, native components, models/assets/data rights, signatures and native user journeys remain separate release prerequisites.

The proprietary original-code notice does not override third-party licenses. Source-dependency licenses and notices are preserved; generated local dependencies/builds remain excluded from source publication.

Primary references: [Nasdaq copyright/disclaimer](https://www.nasdaqtrader.com/trader.aspx?id=copydisclaimmain), [CoinGecko API terms](https://www.coingecko.com/en/api_terms), [Shiller source page](https://shillerdata.com/).



See [Public Repository Safeguards](docs/technical/PUBLIC_REPOSITORY_SAFEGUARDS.md) for the implemented guard, remaining publication checks and GitHub owner/operator settings.

## Current hardening source of truth

- `docs/technical/LIOS_V4_SECURITY_READINESS.md`
- `docs/technical/SECURITY_TEST_MATRIX.md`
- `docs/technical/LIOS_V4_P5_SECURITY_RUNBOOK.md`
- `GET /api/operations/security-acceptance`
- `npm run acceptance:security`
- the authoritative LIOS Quality Gate

A stored route manifest is an inventory, not live authorization/security evidence or an exact-release attestation. Validate current route registration, authorized and hostile requests, and release-bound evidence separately.

## Dependency and independent review

The Quality Gate runs `npm run audit:prod`. The wrapper first uses `npm audit --omit=dev --audit-level=high`; if npm cannot produce a valid report because its registry audit fallback fails, LiOS queries npm's official Bulk Advisory endpoint directly from exact locked production versions. High/critical findings or inability to obtain advisory data fail the gate. The repository currently uses a vendored SheetJS package rather than the historical registry version referenced by older security notes, so old advisory text must not be treated as a current scan result.

The repository audit is not an independent security attestation. P5 intentionally keeps independent dependency/application scanning and an independent security review/penetration test as external release evidence until they are actually completed.
