## Scope and source of truth

- Workstream / issue:
- Canonical owner and affected trust boundary:
- Why this is safe to include in the **public** source distribution:

## Safety review (check every applicable item)

- [ ] No passwords, tokens, signing keys, private datasets, customer/tenant data, local runtime backups, private documents, or unlicensed model/asset bytes.
- [ ] No real secrets in code, test fixtures, environment examples, CI output, commit metadata or the PR description.
- [ ] Donor, fork, vendored archive, asset and data changes include provenance and redistribution-rights review.
- [ ] Changes to auth, sessions, permissions, tenant isolation, agents/exec, sandbox, plugins/MCP, network egress or desktop IPC include fail-closed and abuse-case tests.
- [ ] GitHub Actions use ephemeral GitHub-hosted runners, read-only tokens, no production secrets and no untrusted privileged triggers.
- [ ] Required Linux/macOS/Windows source checks are not bypassed; packaged/release acceptance is not claimed based on source-only CI.
- [ ] Potential vulnerabilities are reported **privately**, not described in a public PR before coordinated remediation.
- [ ] Manual steps, tests and known residual risks are stated truthfully.

## Validation evidence

- Tests run and exact results:
- GitHub checks (links when available):
- Release / native-platform evidence (if applicable; otherwise explicitly not claimed):

## Review

Security, workflow, licensing, dependency and source-publication changes require maintainer review under CODEOWNERS **and GitHub-enforced repository settings**. This checklist alone does not enforce reviews.
