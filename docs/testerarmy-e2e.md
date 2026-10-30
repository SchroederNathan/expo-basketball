# Run the TesterArmy Jordan acceptance check

Use the open source `e2e` runner alongside the four existing agent workflows. The manual [TesterArmy workflow](../.eas/workflows/testerarmy-ios.yml) checks the original Jordan issue on an exact iOS simulator build. The seeded app remains defective. Keep the repaired candidate and PR 4 separate from that seed.

The integration is verified on EAS cloud iOS simulators with subscription authentication. The seeded app fails the two label checks, the repaired app passes all four checks, cached navigation replays without model calls, and the publisher embeds screenshots and video in PR 4.

## Verified presentation runs

These October 30, 2026 runs preserve the original fixture and issue criteria.

| Demo stage | Verified result | Run or evidence |
| --- | --- | --- |
| Seeded app | Historical-points and unknown-stat FAIL; search-back and current-player PASS | [Seed run](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18e40-eaae-7739-a8e4-d1ce316c4f0d) |
| Repaired app | All four checks PASS | [Repair run](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18e4d-20b2-704b-895f-6439e2a44deb) |
| Repeated repaired app | Three fresh attempts PASS; final four navigation acts replay with zero model calls | [Replay run](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18e5a-e1ab-71de-b37a-9a0d9d8bb58c) |
| Public evidence | Complete delivery of six screenshots, unchanged recording, and labeled H.264 playback | [PR evidence](https://github.com/SchroederNathan/expo-basketball/pull/4#issuecomment-6532449683) and [publication run](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18e66-d7ad-7fcb-9bf4-bf04013fa87e) |

The seeded source is `e8ed4e597397b4177fdf2d1c467aaf053444f8cb`. All repaired runs use `ab450ece5c3dccaede339b7c9333bbc696135fb7`. The three replay attempts share one installed build and each capture new assertions, screenshots, and recording. Replay replaces navigation model calls; it does not skip verification.

All six attempts, including the seed, persisted subscription auth and independently confirmed their owned simulator STOPPED. Original media fully decoded, and anonymous public attachment hashes matched. The public comment rendered the expected images and native video controls. PR 4 remains open, preserving the seeded release for another demonstration.

Original recordings contain duplicate timestamps, and some contain backward steps. Playback copies explicitly normalize timing and cannot prove elapsed task time. Actual token rotation and live cancellation recovery remain unverified. An earlier build-metadata command failure and intermittent local process-observer timeout remain unexplained; neither recurred in the successful proof sequence.

## Prepare the local tools

Install Node `22.23.1`, Bun `1.2.22`, FFmpeg, and FFprobe. Install both frozen packages from the repository root.

```sh
bun install --frozen-lockfile --ignore-scripts
bun install --cwd .eas/agents/testerarmy --frozen-lockfile --ignore-scripts
node --version
bun run check
bun run check:agentic
```

The nested package pins `e2e 0.22.0`, mobile `0.12.5`, EAS provider `0.3.2`, `ai 7.0.158`, OpenAI provider `4.0.106`, and mobile's `agent-device 0.21.35`. It leaves the existing tool package and `agent-device 0.21.33` controllers intact. Do not run `e2e init` or add root dependencies or scripts. Invoke the e2e CLI with Node. Bun `1.2.22` cannot run its TypeScript loader.

Run the new offline probe directly with an allowlisted environment.

```sh
env -i PATH="$PATH" HOME=/tmp CI=1 \
  E2E_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 \
  node .eas/agents/testerarmy/offline-check.mjs
```

The probe blocks network calls, uses synthetic credentials, and runs the actual Jordan test with an in-memory engine and no model. It exercises the pinned runner's nonzero assertion failure, strict report admission, OAuth refresh file, public EAS provider with mocked transport, lease recovery, media decoding, and native publisher manifest.

## Provision a dedicated e2e subscription file

Complete independent review and the offline baseline before logging in. The parent operator owns this procedure. Use the approved secure credential channel for any token input. Do not paste credential JSON into chat, reports, logs, or tracked files.

1. Create a dedicated private XDG directory. Use this login only for the serialized e2e workflow stream.
2. Run the supported device login with the pinned Node CLI. Complete the provider's device authorization yourself.
3. Provision its resulting file as the project's preview Secret file variable. The command below passes a file path, not token contents.

```sh
TESTERARMY_LOGIN_DIR=$(mktemp -d)
chmod 700 "$TESTERARMY_LOGIN_DIR"
env -u E2E_OAUTH_CREDENTIALS -u OPENAI_API_KEY -u OPENAI_BASE_URL \
  XDG_CONFIG_HOME="$TESTERARMY_LOGIN_DIR" \
  node .eas/agents/testerarmy/node_modules/e2e/dist/cli/bin.js login openai --device

bun run eas env:create preview \
  --name TESTERARMY_OAUTH_JSON --type file \
  --value "$TESTERARMY_LOGIN_DIR/e2e/oauth.json" \
  --visibility secret --scope project --environment preview --non-interactive
```

`env:create` is retained by pinned EAS CLI `25.3.0`. For a deliberate reseed of the existing variable, use the fixed-variable update command.

```sh
bun run eas env:update preview \
  --variable-name TESTERARMY_OAUTH_JSON --type file \
  --value "$TESTERARMY_LOGIN_DIR/e2e/oauth.json" \
  --visibility secret --environment preview --non-interactive
```

The e2e file is `$XDG_CONFIG_HOME/e2e/oauth.json`. Its strict schema is `{openai:{access,refresh,expires,accountId?,residency?}}`. Expiry uses epoch milliseconds. This integration rejects Codex-shaped documents, additional providers, API-key fields, ambient `E2E_OAUTH_CREDENTIALS`, and custom provider overrides. Do not read or convert a developer's Codex `auth.json`. The existing `CODEX_AUTH_JSON` contract is unchanged.

Provision `AGENT_AUTH_WRITE_TOKEN` through secure input with permission to update this project's preview file variable. The built-in Developer `EXPO_TOKEN` operates EAS devices but does not replace the persistence writer. Retain `AGENT_TRUSTED_AUTOMATION=enabled`, the exact trusted repository, and a reviewed `AGENT_WORKFLOW_BASELINE_SHA` from the [operator runbook](agentic-workflows.md). For a PR destination, also provision the existing controller-only `AGENT_GITHUB_WRITE_TOKEN`.

The controller copies the seed into a private writable XDG file, checks write permission by persisting it before acquisition, and attempts writeback after execution. Only a completed, admitted PASS or genuine assertion FAIL with confirmed normal shutdown can certify that credential stream as persisted. Only the controller gets writer tokens. The worker gets the Developer Expo token and its private subscription store. It cannot fall back to an API key. Per-attempt credential and runner directories are removed before publication. The replay unit keeps its private credential handoff until the unit ends.

Remove the local login directory after approved provisioning. Do not keep using its stale refresh token. Keep all existing and new workflows on `codex-subscription-agentic-ios`, with `queue: max`, no cancellation of an active run, and one e2e worker. A separate login file does not establish provider-side independence between login grants.

If auth is `uncertain` or `write-back-failed`, stop dispatching this credential stream and reseed through the secure path. Interrupted, timed-out, abandoned-model, and otherwise unadmitted executions are uncertain even if every process disappears normally and file writeback succeeds. The runner can exit 130 with an interrupted report while discarding a pending refresh response. Successful writeback preserves the latest file available; it does not prove refresh completion. The replay unit stops and does not hand that credential to another attempt. A completed genuine assertion exit 1 can still have persisted auth.

## Roll out the reviewed controller baseline

The new controller and workflow are protected files. Have the parent review and roll out the same audited implementation baseline to the implementation branch, seeded main or release branch, and repaired PR branch. Keep the original fixture and criteria byte-identical. Do not change the seed, close PR 4, bypass preflight, or repoint a candidate to a convenient binary.

Run authenticated EAS validation after rollout and before dispatch.

```sh
bun run eas workflow:validate .eas/workflows/testerarmy-ios.yml --non-interactive
```

Offline JSON Schema validation does not replace this authenticated validator. The workflow uses Node `22.23.1` and the same fingerprint, successful-lookup build-or-repack graph as Agentic CI. Repack embeds JavaScript and assets. The new installed artifact ID remains separate from the cached native source ID. Metadata verification checks source SHA, native source SHA, profile, simulator platform, runtime, fingerprint, app identifier, and project ID when exposed by EAS metadata.

## Dispatch the seed and repaired proofs

Use the frozen issue number, input digest, and criteria digest from the original acceptance receipt. Use each branch's current full SHA after baseline rollout. Dispatch the seed first with no PR destination.

```sh
TESTERARMY_REF=release/prizepicks-demo
TESTERARMY_SHA=$(git rev-parse "$TESTERARMY_REF")
bun run eas workflow:run .eas/workflows/testerarmy-ios.yml \
  --ref "$TESTERARMY_SHA" \
  -F repository=SchroederNathan/expo-basketball \
  -F target_ref="$TESTERARMY_REF" -F candidate_sha="$TESTERARMY_SHA" \
  -F issue_number="$ORIGINAL_ISSUE_NUMBER" \
  -F issue_digest="$ORIGINAL_ISSUE_DIGEST" \
  -F criteria_sha256=bc07275e877ac808b8067c3dba4696b96a8a27a14408914d455e8d0747464145 \
  --non-interactive
```

The seed must fail the real exact `PTS 18.5, ranked 3rd` assertion on Jordan. An arbitrary nonzero process exit is insufficient. Repeat the command for the repaired branch and its current SHA. All four checks must pass with fresh six-screen capture evidence, exact embedded identity before and after navigation, the original recording, persisted auth, and independent STOPPED verification.

The unknown-stat assertion accepts omission or a safe nonempty label for `4.2`, including `Stat 4.2` and other labels. It rejects a bare numeric label, including whitespace or rank text without a stat name, and duplicate matching tiles. Jordan identity and the other stat and navigation checks still apply. Device evidence cannot prove React key uniqueness. Retain the repaired app's source-level behavior test for keys.

Native search uses `Teams and players`. The search result is `Jordan Vale, Comets · Guard`. These source-grounded locators still need inspection on the cloud iOS accessibility tree. Missing player destinations, timeouts, skipped or repeated tests, provider errors, missing media, uncertain cleanup, or uncertain auth are INCONCLUSIVE.

## Verify repeated repaired runs and cached replay

After an ordinary repaired PASS, dispatch that unchanged repaired candidate with `-F verify_replay=true`. The bounded controller unit runs two recording passes followed by one strict read-only replay. Each pass has its own controller attempt, e2e IDs, owned EAS session, current identity checks, deterministic assertions, recording, cleanup, and auth finalization. The current credential file advances between these serial attempts. The private action cache stays within this unit and is deleted afterward.

Inspect `cache-proof.json`. VERIFIED requires all three passes to succeed on the same source and installed artifact. The final run must show four `agent.act` steps with `cache.mode=self-finalized`, replayed actions, and zero model calls. Strict cache alone is insufficient because missing entries can still invoke the agent. A live fallback keeps the device observation but makes the cache proof INCONCLUSIVE.

The ordinary workflow uses no action cache. The replay unit does not reuse previous screenshots or recordings. This mode is implemented locally; no cloud replay result is claimed yet.

## Publish the PR evidence

Public evidence in this same public repository is already authorized. After artifact-only seed and repair proof, dispatch the repaired candidate with `-F pr_number=4`. The current PR head, ref, repository, and original acceptance receipt must still match. A moving head prevents a current-head publication claim.

The new adapter validates the genuine `report-1` document and e2e process exit. It publishes a separate `TesterArmyResultV1`. It does not forge a legacy Codex Result. The native publisher retains checksum-pinned gh `2.103.1`, immutable manifests, durable create intents, exact author and comment ownership, bounded recovery, anonymous media hashes, rendered screenshot and video verification, and live destination checks.

The public artifacts contain canonical screenshots, the unchanged original MP4, controller result, framework report, and publication receipts. All media passes admission in private staging before any media enters the upload tree. Admission failure retains safe result diagnostics. The PR comment contains screenshots, the downloadable original, and a separately labeled H.264 playback derivative with normalized timing. Cleanup and auth finalize before publication. Required publication failure keeps the observed device verdict and changes workflow status to INCONCLUSIVE.

The controller retries empty discovery, transient lifecycle errors, and delayed STOPPED readback within its existing two-minute recovery deadline. It requires one exact attempt tag, e2e run tag, target, slot name, and bound session ID. Ambiguous or foreign discovery fails closed. For an uncertain owned session after that deadline, use its controller ledger and exact `lob-testerarmy-<attempt UUID>` tag from the result to reconcile it through the EAS simulator commands in the operator runbook. Never stop a session merely because its name resembles another run.
