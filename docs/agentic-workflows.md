# Run the Lob agent workflows

Agentic CI, Bug triage, and Issue to PR have executable manual workflows for the PrizePicks demonstration. QA Swarm remains held until the parent verifies the authentication topology. The parent owns cloud rehearsal and real credential provisioning.
Local tests and EAS YAML validation do not establish cloud E2E success.

The repository remains public at `SchroederNathan/expo-basketball`, as explicitly approved by the operator for subscription authentication. OpenAI's [advanced CI auth guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth) recommends trusted private automation. This workflow retains the operator's public repository choice. Only reviewed same-repository branches are trusted. Removing tokens from the child environment is hygiene. Repository code and the agent run on the same worker and do not form a hostile-code security boundary.

## Prepare the audited revision

The implementation must be reviewed, committed, and pushed before dispatch. None of those operations is performed by the runner.
Set `AGENT_WORKFLOW_BASELINE_SHA` to that reviewed full commit SHA in the EAS preview environment. Candidate branches and PR target branches must contain that baseline.
The controller rejects changes since the baseline to `.eas/agents`, all `.eas/workflows` and `.github` files, `eas.json`, `app.config.ts`, `fingerprint.config.cjs`, `src/api/demo.ts`, `src/demo`, demo fixture bytes, and original demo issue criteria. Later runner changes require another reviewed baseline.

Set these project environment variables in the preview environment before the first cloud run.

| Variable | Value and storage |
| --- | --- |
| `AGENT_TRUSTED_AUTOMATION` | `enabled`, plaintext. An explicit operator opt-in. |
| `AGENT_TRUSTED_REPOSITORY` | `SchroederNathan/expo-basketball`, plaintext. |
| `AGENT_WORKFLOW_BASELINE_SHA` | Full reviewed implementation SHA, plaintext. |
| `CODEX_AUTH_JSON` | Secret **file** variable containing managed ChatGPT `auth.json`. Never a JSON string variable or an API key. |
| `AGENT_AUTH_WRITE_TOKEN` | Secret Expo token authorized to update this project's preview environment variables. Used only by the controller's subscription-file persistence command. |
| `AGENT_GITHUB_WRITE_TOKEN` | Required for triage and Issue to PR, secret. A repository-scoped fine-grained personal access token with Contents, Issues, and Pull requests read/write, plus default Metadata read. No Actions, Workflows, administration, organization, store, or production permissions. The parent provisions it. |
| `AGENT_GITHUB_READ_TOKEN` | Optional repository-scoped read token, secret. Public GitHub source checks work without it but can encounter anonymous rate limits. Ordinary Agentic CI needs no GitHub write token. |

The built-in Developer `EXPO_TOKEN` starts and stops simulators on this account. No separate simulator token is required. Actual cloud probes rejected file-secret updates with both the built-in Developer and Release Manager job tokens. Subscription persistence therefore requires `AGENT_AUTH_WRITE_TOKEN`. Its write permission must succeed before Codex or a simulator starts. The native build and warm repack have completed; subscription execution and remote media export remain unverified.
Do not put unrelated production credentials in this environment.

## Provision subscription auth

The parent requests credentials only when this runner is ready. Do not read a developer's existing local `auth.json` as part of setup or local tests.
Provision a dedicated managed ChatGPT login through the approved secret-delivery path. Its file must contain `auth_mode: "chatgpt"`, access, ID, and refresh tokens, and `last_refresh`. API-key and external-token auth are rejected.

Use this credential only for this serialized workflow stream. Do not keep using its seed copy on another machine, and do not share it with concurrent jobs. The inconclusive parallel-Codex probe does not prove a safe QA auth topology.
All workflow runs share `codex-subscription-agentic-ios` with `queue: max` and `cancel_in_progress: false`. Bug triage and Issue to PR join this same stream. QA Swarm must wait for an approved topology.

The controller copies the Secret file into a private per-attempt `CODEX_HOME` with file mode 0600. It verifies write-back before starting Codex and sets managed ChatGPT authentication with file storage. Codex refreshes through its own normal flow.
In `finally`, the controller validates and writes the resulting file back with its dedicated persistence token through the pinned EAS command. The coding agent does not receive that token.

```sh
EXPO_TOKEN="$AGENT_AUTH_WRITE_TOKEN" bunx eas-cli@25.3.0 env:update preview \
  --variable-name CODEX_AUTH_JSON --type file \
  --value "$PRIVATE_CODEX_HOME/auth.json" \
  --visibility secret --environment preview --non-interactive
```

The argument is a private file path. Token contents are never arguments, logs, uploads, or repository files. The original seed path is never overwritten locally. Raw CLI output and Codex events are not uploaded. Only controller-admitted evidence is public to the artifact reader.
If write-back fails after a refresh, the result is INCONCLUSIVE. Stop this credential stream and reseed through the approved secret channel before retrying. Do not fall back to an API key.
Hard worker termination can prevent write-back. Prefer graceful cancellation, then inspect the receipt and reseed if persistence is uncertain.

## Verify locally

Install `ffmpeg` and `ffprobe` on the operator machine for the media tests. The EAS custom job installs these system tools if absent. No native app dependency was added.

```sh
bun run check
bun run check:agentic
bun run eas workflow:validate .eas/workflows/agentic-ci-ios.yml --non-interactive
```

`check:agents` typechecks the hidden runner directory, runs temporary-Git and fake-executable tests with real decodable media, and checks the workflow structure. `check:fixtures` exercises the existing API boundary in demo mode with live fetch forbidden. These are local unit and controller tests.

The dedicated `agent-preview` profile extends preview, uses a Release iOS simulator build, and has its own channel. Only that profile enables `EXPO_PUBLIC_AGENT_DEMO=prizepicks-v1`.
Normal builds retain their live API, clock, and `appVersion` runtime policy. In demo builds, automatic update checks are disabled, and the native runtime and embedded-launch flag remain observable. Repack embeds candidate JavaScript and assets. It does not publish an OTA update.
`fingerprint.config.cjs` normalizes only the demo `extra.agentDemo.sourceSha` field when hashing Expo config. That embedded JavaScript identity would otherwise force a different native fingerprint on every commit. All other fields remain hashed. This is a fingerprint transform, not a checkout hook or source retarget.

The fixture fixes NBA, October 26, 2026, and America/Toronto. Orbits finish with 100 and Comets with 108. Search finds Avery Stone and Jordan Vale. Images are empty strings that use the existing local fallbacks. Unmatched demo requests fail without contacting the live API.
Jordan's historical `pointsPerGame` and unknown stat names intentionally still become empty labels in the current player schema. `demo/issues/player-label.md` preserves the original fix criteria. A unit test verifies the seed is still present. Only the real coding workflow candidate may replace that baseline assertion with the repaired expectation. This implementation preserves the seed. The ordinary CI prompt checks Avery's current labels and Jordan's search/back journey.

## Dispatch the first cloud slice

Run from the reviewed implementation branch after the preview prerequisites above are in place. The target branch must still resolve to this exact SHA.

```sh
CANDIDATE_SHA=$(git rev-parse HEAD)
bun run eas workflow:run .eas/workflows/agentic-ci-ios.yml \
  --ref "$CANDIDATE_SHA" \
  -F repository=SchroederNathan/expo-basketball \
  -F target_ref=feat/agentic-workflows \
  -F candidate_sha="$CANDIDATE_SHA" \
  --non-interactive
```

`--ref` selects the actual workflow/native source. No checkout hook retargets EAS metadata. The preflight compares branch resolution, candidate SHA, local checkout, baseline ancestry, and any EAS source metadata. Disagreement fails.
The native graph computes a fingerprint, looks up a compatible `agent-preview` simulator build, builds on an empty successful lookup, or repacks a hit. Lookup errors fail rather than masquerading as a cache miss.
The runner fetches installed build metadata again before starting the simulator. Candidate SHA, profile, platform, simulator suitability, native fingerprint, app ID, runtime, installed build ID, and optional native source build/SHA must agree.
Manual success and a later real `pull_request` trigger are separate proofs. PR runs target `main` or `release/**`, require a non-draft same-repository head, and recheck the current PR author association and SHA through GitHub. Forks receive no agent run. The parent owns enabling or rehearsing that event path.

## Read the result and recover

Each attempt writes `agent-output/public/<attempt UUID>/`. The EAS artifact contains the controller result, target, original check criteria, report, observed identity, admitted PNG screenshots, and an MP4 recorded through the owned agent-device session. Every evidence file in the result has its relative path, byte size, and SHA-256 digest. No old attempt directory supplies evidence to a new run.

`Target` is a strict Zod-derived check target with controller/source refs and SHAs, repository/PR identity, fixed iOS profile/runtime, fixture identity, criteria digest, built-or-repacked native identity, and an embedded candidate bundle.
`Session` contains the owned EAS ID, private account session URL, attempt ID, and maximum-duration deadline. It contains no access token.
`Result` separates PASS/FAIL with complete evidence from INCONCLUSIVE with a reason and partial evidence. It also records process termination, cleanup, auth persistence, and tool versions.

PASS requires all three acceptance checks, distinct valid screenshots, a controller-observed exact source/fixture/native-runtime/embedded identity, independently observed final scores, a decodable recording of at least one second, successful agent termination, confirmed scoped simulator stop, and persisted auth. Missing evidence, stale files, symlinks, mismatches, malformed JSON, timeouts, or unconfirmed cleanup remain INCONCLUSIVE. An observed acceptance failure with the same evidence requirements is FAIL. Agent exit zero or a PASS sentence alone is insufficient.

Startup is bounded to four minutes and Codex to fifteen minutes. Recording export and device close each have a two-minute limit, simulator cleanup has a two-minute total budget, and auth write-back has one minute. The simulator has a thirty-minute maximum duration as a backstop.
On partial startup, cleanup queries only the attempt's unique name and tag. It never calls an unscoped stop. A stop receipt must report the owned ID and STOPPED, followed by an independent get confirming STOPPED.

If a worker is killed or cleanup is unconfirmed, inspect the attempt receipt and stop only its owned session.

```sh
bun run eas simulator:get --id "$SESSION_ID" --json --non-interactive
bun run eas simulator:stop --id "$SESSION_ID" --json --non-interactive
```

If the ID was not returned, use the attempt tag `lob-<attempt UUID>` with `simulator:list`, verify its exact name/tag, and stop that ID. An expiry estimate is not confirmed cleanup.
The workflow's final job fails unless the controller returns the exact state PASS. Ordinary Agentic CI makes no GitHub writes. The two issue controllers below publish only after validating their results. These workflows never merge, release, submit to a store, or publish an update.


## Prepare a trusted synthetic issue

Wait for the parent's first cloud/auth proof. Review and publish this implementation, then advance the audited baseline before dispatching its new workflows. Do not change EAS variables from an agent task.
Prepare `release/prizepicks-demo`, or choose another explicit target branch containing that reviewed baseline. Current `main` lacks it. There is no implicit default-branch fallback.

Create an open same-repository issue owned by an OWNER, MEMBER, or COLLABORATOR. Include this exact marker in its body, then describe the Jordan Vale label bug and copy the original criteria from `demo/issues/player-label.md`.

```text
<!-- lob-demo:player-label -->
```

The marker is a supported-demo-issue check, not an authorization grant. Only trusted reviewed source and synthetic issues are supported. Issue prose cannot choose refs, commands, paths, credentials, or acceptance criteria. Unknown issues, PR numbers passed as issues, foreign identities, closed issues, and untrusted authors fail before subscription auth is loaded.
The controller snapshots GitHub's numeric and node identity, title, body, author association, URL, and timestamp. It hashes the semantic input separately from the timestamp, since comments change `updated_at`. It also copies the exact original criteria and records their SHA-256. Later jobs require the same issue-content and criteria digests.

The GitHub publisher initially supports a fine-grained PAT. It calls `GET /user` to establish comment ownership. A GitHub App installation token is not established by this implementation. [GitHub's comment API](https://docs.github.com/en/rest/issues/comments) and [PR API](https://docs.github.com/en/rest/pulls/pulls) define the repository permissions used here.
The controller supplies this token only to its HTTP and Git subprocesses. The Codex child receives neither it, the read token, nor EXPO_TOKEN. Coding tests also receive no such tokens. The EAS worker remains a trusted-code environment, not a hostile-code isolation boundary. Preview secrets may be accessible to trusted worker code. Do not add production secrets there.

## Triage the selected baseline artifact

Set ISSUE_NUMBER and TARGET_SHA from the prepared issue and target. TARGET_SHA must be the exact current target commit and the workflow `--ref`.

```sh
bun run eas workflow:run .eas/workflows/bug-triage.yml \
  --ref "$TARGET_SHA" \
  -F repository=SchroederNathan/expo-basketball \
  -F target_ref=release/prizepicks-demo \
  -F candidate_sha="$TARGET_SHA" \
  -F issue_number="$ISSUE_NUMBER" --non-interactive
```

The native graph selects the artifact using the same fingerprint/build-or-repack path as CI. It does not test the latest unrelated binary. The controller verifies installed build metadata and on-device source, fixture, runtime, and embedded-launch identity before asking Codex to inspect the original criteria.
The four issue checks are `historical-points`, `unknown-stat`, `current-player`, and `search-back`. Their prompt is separate from `check-ios.md`. Device interpretation covers visible unknown-stat behavior. Coding regression tests must also cover source-level key safety.

REPLICATED requires an observed original-criteria failure, successful Codex termination, distinct admitted PNGs, a decodable owned-session recording, independently observed identity, persisted subscription auth, and confirmed scoped stop. NOT_REPLICATED requires all original checks to pass with that same evidence. The conclusion applies only to the recorded source, fixture, and installed artifact. Source inspection is never reproduction evidence.
Missing verdicts or evidence, uncertain UI, mismatched identity, and cleanup or persistence failures remain INCONCLUSIVE. An incomplete attempt can receive an explicitly inconclusive issue comment when its target/input identity is known. The workflow still fails.

After result validation and an unchanged-input check, the controller upserts one issue comment using an issue-and-target marker. It verifies the existing comment belongs to the token owner, rejects duplicate or foreign markers, and links the workflow artifacts and owned session. Screenshot, recording, identity, source, build, fixture, criteria, and issue digests identify the evidence. It never closes or labels the issue.
A publication failure preserves the device `result.json`, fails the workflow status, and leaves the GitHub update unverified. `publication.json` records a successful comment receipt.

## Turn the issue into one reviewable PR

Use the same prepared target and frozen issue. Keep all runs in the shared subscription queue.

```sh
bun run eas workflow:run .eas/workflows/issue-to-pr.yml \
  --ref "$TARGET_SHA" \
  -F repository=SchroederNathan/expo-basketball \
  -F target_ref=release/prizepicks-demo \
  -F candidate_sha="$TARGET_SHA" \
  -F issue_number="$ISSUE_NUMBER" --non-interactive
```

Codex receives a disposable source tree with dependencies installed and no Git metadata. It can edit only TypeScript source and tests under `src` or `app`. The controller rejects all other files, untracked forbidden files, links, permission changes, deletions, demo acquisition/identity code, fixture bytes, criteria, dependency/config/native changes, and workflow/auth changes. The controller admits changes only from the disposable source tree.
The coding prompt asks for a local failing behavioral reproduction, a minimal repair, and a regression test. The controller does not claim it independently observed the agent's pre-fix failing test. It independently installs the frozen lockfile, typechecks, and runs application tests in its own candidate checkout before committing. The controller also requires a changed behavioral test file. Real on-device repair acceptance belongs to downstream CI.

Only the controller commits, pushes normally, and creates the PR. Before remote writes it persists refreshed auth, rechecks the issue/criteria, exact target SHA, and remote issue branch. It never force-pushes. PR base is the explicit target, normally `release/prizepicks-demo`.
The deterministic branch is `agent/issue-<number>-<target-ref digest prefix>`. A rerun accepts only a single candidate commit directly descending from the frozen target, carrying the exact controller ownership/acceptance receipt and only allowed changes. It repeats typecheck and tests, then reuses the branch and PR. It does not rerun Codex or consume subscription auth for an already validated candidate.
A human branch commit, observed moved base, changed issue/criteria, closed or conflicting PR, duplicate PRs, or non-fast-forward push conflict returns CONFLICT. The controller preserves any branch or PR already created for reconciliation. An ordinary push rejection never escalates to a force push. Another actor creating the issue branch at the expected ancestor can still allow an ordinary fast-forward; that race does not lose commits. After a push-before-PR error, rerun the same request to reconcile. A lost PR response also reconciles to the existing PR.
NO_CHANGE requires an explicit no-change agent verdict and no source diff, commit, or PR. An inconclusive verdict or contradictory diff remains INCONCLUSIVE. REJECTED means an out-of-bounds patch. PR_READY means controller local checks passed, the PR receipt's base SHA matched the frozen target, and the final target check still matched. A later target advance requires fresh validation. Native acceptance remains separate.

The PR body carries a versioned immutable acceptance receipt with the original target, issue identity/content digest, and original criteria digest. Artifacts retain `issue-input.json`, `criteria.md`, `acceptance.json`, `checks.json`, `publication.json`, `result.json`, and the report. A receipt is not cryptographic provenance against a trusted maintainer deliberately forging it.

## Check the repaired PR against the original criteria

For a same-repository PR targeting `release/**`, Agentic CI reads the controller receipt and uses the original issue criteria automatically. It checks baseline ancestry, protected-file identity, the frozen issue-content digest, and the original criteria digest. The repaired candidate is built or repacked at its own SHA.
Issue branches without a valid receipt fail closed. Ordinary PRs and the first baseline manual check continue using the existing three-check `check-ios.md` prompt. A baseline PASS never claims Jordan's seeded labels were repaired.

PR-triggered checks post their verdict, candidate SHA, attempt ID, and workflow evidence link through EAS's GitHub Comment job. Manual checks retain the same artifacts on the workflow page. The linked Expo project must have its GitHub repository connection enabled for PR triggers and comments.

For a manual acceptance run or an explicit target outside the PR trigger's branch filter, take the candidate SHA, branch, issue digest, and criteria digest from the controller artifacts.

```sh
bun run eas workflow:run .eas/workflows/agentic-ci-ios.yml \
  --ref "$FIX_SHA" \
  -F repository=SchroederNathan/expo-basketball \
  -F target_ref="$FIX_BRANCH" \
  -F candidate_sha="$FIX_SHA" \
  -F issue_number="$ISSUE_NUMBER" \
  -F issue_digest="$ISSUE_DIGEST" \
  -F criteria_sha256="$CRITERIA_SHA256" --non-interactive
```

Manual issue acceptance requires both digests. It cannot silently derive a new acceptance contract from edited issue text. All original checks must pass for CI PASS, with the same evidence/cleanup/auth requirements as the baseline lifecycle.

## Rehearse this unit

Run `bun run check` and `bun run check:agentic`, then validate each changed workflow with EAS CLI 25.3.0. Controller tests use synthetic auth, real temporary Git repositories, local HTTP GitHub fixtures, fake unavailable agent/cloud executables, and real decodable media. They make no real GitHub writes or cloud runs.

The parent still needs to prove triage REPLICATED on the baseline, a real coding PR, duplicate issue dispatch, acceptance PASS on the repaired native candidate, NOT_REPLICATED on that artifact, evidence upload/comment visibility, and refreshed-auth/cleanup receipts across serialized runs. The [label bridge](agent-label-bridge.md) adds the issue entry point after installation on `main` and actual Actions rehearsal. QA Swarm remains held pending its lifecycle fixes and authenticated topology proof.
