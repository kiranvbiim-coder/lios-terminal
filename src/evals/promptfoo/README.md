# Optional Promptfoo offline routing pilot (ENG-05 / SI-02, SI-07)

This developer-only adapter is the **first evaluation of a new external donor**, not a shipping feature or imported Promptfoo runtime. It uses Promptfoo's custom-JavaScript-provider interface while preserving the existing LiOS golden cases and real Conversation Runtime planner as the only routing authority.

- Config: `evals/promptfoo/promptfooconfig.yaml`; only approved `must_pass` case IDs from `evals/golden/routing.json` are accepted.
- Provider: bounded Node child process, no shell, 15-second timeout, no network/provider/secret requirements and no arbitrary user-supplied command execution.
- Output: actual planner capability/entity results and test failures, with fail-closed handling for invalid IDs, process errors and malformed responses.
- Baseline: `npm run eval:golden` remains the primary, project-owned golden scorecard; `node --test script/promptfooGoldenProvider.test.cjs` tests this adapter.

## Optional developer execution

Use **an independently reviewed and pinned Promptfoo CLI** in an isolated developer environment with Node.js **22.22+**, as required by Promptfoo's current Node package docs. From `src/` run:

```shell
promptfoo eval -c evals/promptfoo/promptfooconfig.yaml --no-progress-bar --no-table
```

The main project does **not** install or execute Promptfoo in its production dependency graph or source CI. No version has been approved or pinned yet, so this is a candidate adapter, not evidence of CLI execution. Do **not** use `npx ...@latest`, automatically install a donor or invoke a paid model on behalf of the user. A future CA review must verify the exact upstream tag/commit, distribution rights and dependency/Node compatibility before adopting a pinned developer tool.

These checks use fixed project-owned routing prompts **only**. They do not evaluate live AI safety, real citation accuracy, tool execution, model responses, cost, SP-02/03, a packaged app or release readiness. Never promote a routing success into those claims. See `docs/technical/LIOS_DONOR_IMPORT_REUSE_POLICY.md` and issue #91.
