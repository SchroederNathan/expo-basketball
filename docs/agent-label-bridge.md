# Enable the GitHub issue label bridge

Use this bridge to start the existing PrizePicks demo workflows from trusted issues in public `SchroederNathan/expo-basketball`. The `agent` label starts Issue to PR. The `agent-triage` label starts Bug triage.

The controller dispatches EAS and exits without waiting for the cloud result. A successful Actions job establishes dispatch acceptance only. Real GitHub event delivery, Actions token access, Expo credentials, and cloud outcomes remain unverified by this implementation.

## Install the reviewed controller on main

1. Have the integration owner review and publish `.github/workflows/agent-label.yml`, `scripts/agent-label.mjs`, and their tests on `main`, the repository's default branch. GitHub requires the workflow on the default branch for [issue events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues).
2. Prepare a reviewed same-repository target branch that contains the audited EAS workflows, runner, and current baseline. The bridge never checks out this target in Actions.
3. Update `AGENT_WORKFLOW_BASELINE_SHA` in EAS preview to the reviewed implementation commit. Include the new `.github` file in that baseline. The existing EAS preflight protects `.github` and requires the target to contain the baseline.
4. Set the GitHub repository variable `AGENT_DEMO_TARGET_REF` to the chosen target branch. If absent or empty, the bridge uses `release/prizepicks-demo`. It never selects `main` implicitly. Choose `main` explicitly through this variable or a manual `target_ref` only after preparing it.
5. Provision the GitHub Actions repository secret `EXPO_AGENT_TOKEN` through the approved secure-input process. Use an Expo token authorized to run workflows for the original linked project, `44a06072-fb9b-4334-ba72-29e7c2d61bc6`. This implementation neither reads nor provisions real credentials.
6. Complete the existing [EAS preview and subscription setup](agentic-workflows.md#prepare-the-audited-revision). The bridge does not change the EAS `CODEX_AUTH_JSON`, `AGENT_AUTH_WRITE_TOKEN`, or `AGENT_GITHUB_WRITE_TOKEN` contracts. OpenAI authentication remains managed subscription authentication.

Keep the Expo dispatch token in Actions as `EXPO_AGENT_TOKEN`. The controller supplies it only to the EAS subprocess as `EXPO_TOKEN`. It passes neither `GITHUB_TOKEN` nor other Actions secrets to that subprocess. The bridge's `GITHUB_TOKEN` performs only GitHub API reads. The EAS publication credential stays in EAS preview.

The workflow requests only `contents: read` and `issues: read`. GitHub documents Metadata read for [`GET /repos/{owner}/{repo}/collaborators/{username}/permission`](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user). The endpoint supports installation access tokens, and its legacy `permission` maps maintain to write. The implicit Metadata read permission is expected to suffice for `GITHUB_TOKEN`. Confirm this in the first real Actions rehearsal. A denied permission request fails closed without a fallback credential or elevated workflow permission.

## Start an issue workflow

1. Use an open issue in `SchroederNathan/expo-basketball` with an author association of `OWNER`, `MEMBER`, or `COLLABORATOR`.
2. Include the exact marker `<!-- lob-demo:player-label -->` in its body and retain the original criteria from `demo/issues/player-label.md`.
3. As a repository writer, maintainer, or administrator, apply `agent` for Issue to PR or `agent-triage` for Bug triage.
4. Inspect the **Agent issue bridge** Actions log for the operation, workflow path, issue number, target branch, and resolved SHA.
5. Inspect that source in the original project's EAS workflow history for the cloud result and evidence. Follow the [existing result and recovery instructions](agentic-workflows.md#read-the-result-and-recover).

The controller re-reads the current issue. A stale event cannot admit a closed issue, removed label, missing marker, pull request, different repository, or untrusted author. It also checks the labeling actor's current repository permission. On a rerun, the triggering actor must have write access too.

The controller resolves only a branch in this repository using GitHub's [Get a reference endpoint](https://docs.github.com/en/rest/git/refs#get-a-reference). It rejects a missing, invalid, ambiguous, non-commit, or moving ref. The same full SHA becomes EAS `--ref` and `candidate_sha`. The other inputs are the fixed `repository`, explicit `target_ref`, and validated `issue_number`.

EAS performs its existing baseline, source, issue, author, and criteria checks again. A change after bridge verification can therefore fail EAS preflight. No bridge result replaces those checks.

The Actions checkout contains only the trusted controller revision from the default branch. It fetches full Git history for EAS CLI's local ref resolution and disables persisted checkout credentials. It installs that revision's frozen dependencies before the secret-bearing controller step. Bun is fixed to `1.2.22`, EAS CLI to `25.3.0`, and both Actions are pinned to full commit SHAs. Issue text never supplies commands, workflow paths, or target refs.

## Use manual dispatch

1. In **Actions**, open **Agent issue bridge** and select **Run workflow**.
2. Select `main` as the workflow source. A workflow dispatched from another branch is skipped.
3. Enter `issue_number` as a positive decimal integer.
4. Choose `operation` from `issue-to-pr` and `bug-triage`.
5. Enter a reviewed branch in `target_ref`, or leave it blank to use `AGENT_DEMO_TARGET_REF` and then `release/prizepicks-demo`.
6. Start the workflow and inspect its Actions log and EAS result.

A manual run uses the same issue and actor checks. It does not require either label to remain applied. Target branches use a conservative ASCII syntax with letters, digits, dots, underscores, hyphens, and slashes. Components cannot be empty, start or end with a dot, or end with `.lock`. `..` and names over 200 characters are rejected.

## Verify without dispatch

Run the install-free local tests with Bun `1.2.22`.

```sh
bun test ./scripts/agent-label.test.ts
node --check scripts/agent-label.mjs
```

The tests use localhost GitHub fixtures, injected dispatches, and an inert temporary executable. They parse the actual Actions YAML with Bun's built-in YAML parser. They need no project install, real credentials, GitHub writes, or cloud runs. The integration owner can add this test command to the shared check command without changing this bridge.

For a read-only API rehearsal in an Actions-compatible environment, run the controller with `--dry-run`.

```sh
bun scripts/agent-label.mjs --dry-run
```

Supply a saved JSON event through `GITHUB_EVENT_PATH` and the matching GitHub context variables `GITHUB_REPOSITORY`, `GITHUB_EVENT_NAME`, `GITHUB_ACTOR`, `GITHUB_TRIGGERING_ACTOR`, `GITHUB_REF`, `GITHUB_SHA`, and `GITHUB_WORKFLOW_REF`. The workflow ref must be `SchroederNathan/expo-basketball/.github/workflows/agent-label.yml@refs/heads/main`. Supply an authorized read token through `GITHUB_TOKEN` using the secure environment mechanism. This mode reads GitHub and returns the exact dispatch plan. It needs no Expo token and never starts a subprocess or cloud job.

## Recover from a failure

Ignored events exit successfully with a fixed reason and make no EAS call. Missing credentials, API failures, malformed API JSON, and dispatch failures exit unsuccessfully. Redirects are refused, each API request has a 20-second deadline, and the dispatch subprocess has a two-minute deadline. Raw subprocess output stays out of the Actions log.

If dispatch fails or times out, inspect EAS before retrying. The server may have accepted the request before the response was lost. The bridge makes one attempt and does not claim exactly-once dispatch. The existing EAS Issue to PR controller owns candidate and PR reconciliation.

The bridge has no Actions concurrency group. Each request only validates inputs and dispatches EAS, so there is no shared local state to serialize. A default Actions concurrency group can replace a pending triage request with a later coding request. See [GitHub's concurrency contract](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

The EAS workflows own serialization through their global `codex-subscription-agentic-ios` group with `queue: max` and cancellation disabled. Up to 100 runs can wait there. Arrival order can differ from issue event order. This bridge does not create, close, or label issues, create PRs, push commits, merge, or deploy. The selected EAS controller owns any authorized publication after its own validation.
