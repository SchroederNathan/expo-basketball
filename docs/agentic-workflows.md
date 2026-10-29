# Run the first Lob iOS agent check

This unit implements the shared runner and one Agentic CI iOS workflow for the PrizePicks demonstration. Issue-to-PR, QA Swarm, and bug triage are later units.
Local tests and EAS YAML validation do not establish cloud E2E success.

The repository remains public at `SchroederNathan/expo-basketball`, as explicitly approved by the operator for subscription authentication. OpenAI's [advanced CI auth guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth) recommends trusted private automation. This workflow retains the operator's public repository choice. Only reviewed same-repository branches are trusted. Removing tokens from the child environment is hygiene. Repository code and the agent run on the same worker and do not form a hostile-code security boundary.

## Prepare the audited revision

The implementation must be reviewed, committed, and pushed before dispatch. None of those operations is performed by the runner.
Set `AGENT_WORKFLOW_BASELINE_SHA` to that reviewed full commit SHA in the EAS preview environment. Candidate branches and PR target branches must contain that baseline.
The controller rejects changes since the baseline to `.eas/agents`, this workflow, `eas.json`, `app.config.ts`, `fingerprint.config.cjs`, `src/api/demo.ts`, `src/demo`, demo fixture bytes, and original demo issue criteria. Later runner changes require another reviewed baseline.

Set these project environment variables in the preview environment before the first cloud run.

| Variable | Value and storage |
| --- | --- |
| `AGENT_TRUSTED_AUTOMATION` | `enabled`, plaintext. An explicit operator opt-in. |
| `AGENT_TRUSTED_REPOSITORY` | `SchroederNathan/expo-basketball`, plaintext. |
| `AGENT_WORKFLOW_BASELINE_SHA` | Full reviewed implementation SHA, plaintext. |
| `CODEX_AUTH_JSON` | Secret **file** variable containing managed ChatGPT `auth.json`. Never a JSON string variable or an API key. |
| `AGENT_GITHUB_READ_TOKEN` | Optional repository-scoped read token, secret. Public GitHub source checks work without it but can encounter anonymous rate limits. No GitHub write token is needed. |

The built-in Developer `EXPO_TOKEN` starts and stops simulators and updates the file secret. No separate simulator token is required. Simulator start/stop was already proved by the parent. File-secret update permission, subscription execution, the native build, and remote media export still require the real cloud slice.
Do not put unrelated production credentials in this environment.

## Provision subscription auth

The parent requests credentials only when this runner is ready. Do not read a developer's existing local `auth.json` as part of setup or local tests.
Provision a dedicated managed ChatGPT login through the approved secret-delivery path. Its file must contain `auth_mode: "chatgpt"`, access, ID, and refresh tokens, and `last_refresh`. API-key and external-token auth are rejected.

Use this credential only for this serialized workflow stream. Do not keep using its seed copy on another machine, and do not share it with concurrent jobs. The inconclusive parallel-Codex probe does not prove a safe QA auth topology.
All workflow runs share `codex-subscription-agentic-ios` with `queue: max` and `cancel_in_progress: false`. Later workflows must use a separately approved credential topology or join this same stream.

The controller copies the Secret file into a private per-attempt `CODEX_HOME` with file mode 0600. It verifies write-back before starting Codex and sets managed ChatGPT authentication with file storage. Codex refreshes through its own normal flow.
In `finally`, the controller validates and writes the resulting file back with the built-in job token through the pinned EAS command.

```sh
bunx eas-cli@25.3.0 env:update preview \
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
Jordan's historical `pointsPerGame` and unknown stat names intentionally still become empty labels in the current player schema. `demo/issues/player-label.md` preserves the original fix criteria. A unit test verifies the seed is still present. Replace that baseline assertion with the repaired expectation in the later fix unit. This first CI prompt checks Avery's current labels and Jordan's search/back journey.

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
The workflow's final job fails unless the controller returns the exact state PASS. No GitHub comments, issue writes, PR creation, production release, or update publication occur in this unit.
