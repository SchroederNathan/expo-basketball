# QA Swarm

QA Swarm checks one exact Lob iOS candidate through three concurrent Codex threads and three owned remote simulators. It uses the public `SchroederNathan/expo-basketball` repository and managed ChatGPT subscription file authentication. It has no API-key fallback.

The [Linux concurrency probe](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18610-217b-7052-85a2-5efc365bdb56) passed 16 protocol and process cleanup checks, then verified three authenticated overlapping threads with separate shell environments, a healthy server exit, and persisted auth. The three-session app journeys still need their own cloud evidence. Neither result establishes a 30-minute completion-time guarantee.

## Execution contract

The native graph matches Agentic CI. Preflight verifies the candidate, fingerprint computes native identity, get-build finds a compatible simulator build, and either build or repack produces the installed candidate. A repack keeps its source build ID and SHA separate from the installed build ID and candidate SHA. Every native job uses the `preview` environment and `agent-preview` profile.

One EAS custom job owns the entire swarm. Its concurrency group is `codex-subscription-agentic-ios`, with `queue: max` and `cancel_in_progress: false`. Every workflow consuming this credential must use that same group. The group serializes runs. Inside a run, the three model turns execute concurrently.

The controller seeds one isolated `CODEX_HOME` with the existing `seedSubscription` helper. It proves writeback with `persistSubscription` before opening any simulator. It then launches one pinned Codex 0.165.0 app-server over stdio. Each ephemeral thread has a separate working directory and a `shell_environment_policy` override with `inherit: none` and its own environment map. The server environment contains neither remote session tokens nor `EXPO_TOKEN`.

Each thread uses `gpt-6.1-sol`, `xhigh` reasoning, and `priority` service. Remote tokens enter only that thread's shell environment. They never appear in the prompt or public protocol logs. Raw stdout events, tool output, RPC errors, and stderr are not published. The controller publishes only selected identity fields, strict verdicts, timing receipts, screenshots, and recordings.

| Lane | Acceptance check | Agent screenshot |
| --- | --- | --- |
| `scores` | October 26 Scores, Orbits 100, Comets 108, Final, game detail, and Avery Stone in leaders. | `scores.png` |
| `current-player` | Search Avery, open Avery Stone, and observe PTS 24.0, REB 6.0, AST 8.0 with meaningful accessibility labels. | `current-player.png` |
| `search-back` | Search Jordan, open Jordan Vale and his game log, then Back preserves the query and result. | `search-back.png` |

All lanes use `prizepicks-v1`, date `20261026`, and timezone `America/Toronto`. Each lane controls only its own device. Each returns exactly one strict check result. The Jordan historical-label defect belongs to the separate fix exercise.

Before every turn, the controller observes the installed app's embedded source SHA, fixture digest, and runtime. It records an independent screenshot before and after the turn. The agent captures the lane screenshot. Each lane has its own decoded MP4 recording. After a passing observation, the controller independently confirms the final Scores content and embedded identity.

The client records distinct thread and turn IDs. A concurrent result requires a nonempty common interval between the three received `turn/started` and `turn/completed` notifications. A final assistant message without successful turn completion cannot pass. A model's claim to have spawned agents is not used as evidence.

The controller collects every lane result even when another lane fails. It closes the server before final device cleanup, stops recording, closes each device client, and confirms each owned simulator's stopped state. It persists the resulting subscription file only through the existing helper, then removes the private directories. A failed turn, missing artifact, identity mismatch, nonconcurrent execution, unconfirmed cleanup, or failed auth persistence makes the swarm `INCONCLUSIVE`. A fully evidenced acceptance failure is `FAIL`. Only three fully evidenced passes produce `PASS`.

Evidence validation decodes the complete MP4. PNG validation decodes one frame. Each file has a shared 30-second probe and decode deadline. A corrupt later frame or a deadline failure makes the lane `INCONCLUSIVE`.

The server shutdown receipt includes its exit code or signal. Healthy shutdown requires exit code zero, closed pipes, no forced termination, and confirmed cleanup of the tracked process groups. The controller tracks descendant groups using PID, parent PID, process group, and start time from `/bin/ps`. It captures descendants before EOF or fatal teardown, retains observed detached groups after reparenting, and freezes surviving groups before discovering and killing their remaining descendants. Shutdown has a total budget of three times `stopMs`, normally 30 seconds in the swarm, plus event-loop and OS scheduling. At the deadline it destroys its pipe handles and returns `unconfirmed` if cleanup was not established.

Process-tree tracking is not kernel containment. A process that forks and reparents entirely between snapshots can escape discovery. Unexpected launcher exit or failed process inspection prevents a healthy receipt. Linux EAS cleanup and any daemonization used by the actual device tools still need integration proof.

The agent deadline is 15 minutes per turn. The controller cancels active work after 20 minutes to reserve time for bounded cleanup. Remote sessions retain their 30-minute expiry. Native build queues and cold build duration are outside the controller deadline. SIGKILL or worker loss cannot run `finally`; the parent must confirm session expiry or scoped cleanup and reseed auth before another run if refreshed credentials were lost.

This is trusted automation on one worker. Per-thread environment maps and directories prevent accidental sharing. They are not a hostile-code isolation boundary between processes running as the same OS user.

## Environment requirements

The parent owns credential provisioning, cloud proof, and integration. No new repository or private-repository requirement is introduced.

| Variable | Required value |
| --- | --- |
| `CODEX_AUTH_JSON` | Existing Secret EAS file variable in `preview`. Its value is an absolute path to managed ChatGPT `auth.json` with refresh tokens. Never pass the JSON itself. |
| `EXPO_TOKEN` | Built-in Developer token in the EAS job for simulator operations. |
| `AGENT_AUTH_WRITE_TOKEN` | Dedicated Secret Expo credential authorized to update the subscription Secret file. Built-in Developer and Release Manager job tokens failed that operation in real probes on this account. |
| `AGENT_TRUSTED_AUTOMATION` | `enabled`. |
| `AGENT_TRUSTED_REPOSITORY` | `SchroederNathan/expo-basketball`. |
| `AGENT_WORKFLOW_BASELINE_SHA` | Audited integrated commit containing these QA files and the shared controller. The original pre-QA baseline is not sufficient after integration. |
| `AGENT_REPOSITORY` | `SchroederNathan/expo-basketball`. Supplied by the workflow input. |
| `AGENT_SOURCE_REF`, `AGENT_SOURCE_SHA` | Branch and exact candidate SHA. The workflow must also be dispatched with that SHA as `--ref`. |
| `AGENT_PR_NUMBER` | Optional same-repository trusted PR number. |
| `AGENT_BUILD_ID`, `AGENT_FINGERPRINT` | Installed candidate build ID and native fingerprint from the native graph. |
| `AGENT_NATIVE_SOURCE_BUILD_ID`, `AGENT_NATIVE_SOURCE_SHA` | Both required for a repack, otherwise empty. |
| `AGENT_RUN_ID`, `AGENT_RUN_URL` | EAS workflow metadata. |
| `AGENT_GITHUB_READ_TOKEN` | Optional read credential for source verification. It is never forwarded to Codex. |

`OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, and `CODEX_AUTH_TOKEN` are rejected by the shared subscription helper. The job needs Bun 1.2.22, EAS CLI 25.3.0, Codex 0.165.0, agent-device 0.21.33, FFmpeg, and FFprobe. The workflow installs the media tools when absent.

## Run the parent concurrency probe

The probe launches no devices and performs no app checks. It uses the same seed and persistence helpers as the swarm. It updates the existing EAS Secret file variable before model work and again after server shutdown. Run it only in the parent's authorized credential context, with `CODEX_AUTH_JSON` and `AGENT_AUTH_WRITE_TOKEN` already supplied securely. It never reads the developer's default Codex auth file. After a cloud run may have refreshed credentials, run the probe in the same serialized EAS stream using the current Secret file rather than a stale local seed.

Use the dedicated workflow so it consumes the current Secret file in the same subscription queue. Its first step verifies the exact source. Before any model turn, it runs the pinned protocol tests and shared command cleanup regressions on the Linux worker. Those regressions include real process snapshots that miss the launcher while observing its remaining group members.

```sh
bunx eas-cli@25.3.0 workflow:run .eas/workflows/codex-concurrency-probe.yml \
  --ref "$CANDIDATE_SHA" \
  -F repository=SchroederNathan/expo-basketball \
  -F target_ref="$CANDIDATE_BRANCH" \
  -F candidate_sha="$CANDIDATE_SHA" \
  --non-interactive
```

The workflow retains `agent-output/probe/public/result.json`. The controller entry point is `bun .eas/agents/codex-probe.ts <new-output-path>` for an already isolated, serialized credential context.

The probe starts three ephemeral threads, injects distinct random synthetic markers, and asks each to run a controller-written script. It validates each shell-written receipt against the expected marker, thread ID, working directory, and timestamps. It also checks the model's strict response and overlapping turn notifications. Markers, private paths, raw events, and credentials are excluded from the published receipt. The receipt includes thread and turn IDs, controller timestamps, the process ID, shutdown state, and auth persistence status.

Exit 0 means the subscription concurrency probe passed. Exit 2 means it did not establish the required proof. The native-subagent ALPHA/BETA experiment without spawn IDs remains inconclusive and is not substituted for this probe.

## Dispatch the swarm after integration

Set the audited baseline and trusted automation variables before dispatch. Select a branch containing that baseline and use its exact SHA.

```sh
bunx eas-cli@25.3.0 workflow:run .eas/workflows/qa-swarm.yml \
  --ref "$CANDIDATE_SHA" \
  -F repository=SchroederNathan/expo-basketball \
  -F target_ref="$CANDIDATE_BRANCH" \
  -F candidate_sha="$CANDIDATE_SHA" \
  --non-interactive
```

The separate direct command is `bun .eas/agents/qa-swarm.ts run`. It requires the same environment inputs and installed build metadata. `bun .eas/agents/qa-swarm.ts preflight` verifies the source, workflow baseline, and subscription configuration without starting devices or Codex.

Results are under `agent-output/qa/public/<attempt-id>/`. Each lane has its own directory. `result.json` binds the target, sessions, thread receipts, media hashes, cleanup, and subscription persistence. `report.md` summarizes the result. `agent-output/qa/status.json` supplies the final EAS gate. Missing status or any state other than `PASS` fails the workflow. The upload includes only the public evidence subtree.

A failed device command retains its operation and process termination in `deviceFailure`. When the CLI returns a recognized structured error, its bounded code and message are redacted before publication. Launcher failures can precede that JSON response, so failed commands also retain at most 2,000 characters from each output stream, after credential and URL redaction. Successful command output remains excluded. Later stage and cleanup errors do not overwrite the first device failure.

## Reproduce local checks

```sh
bunx tsc --noEmit -p .eas/agents/tsconfig.json
bun test ./.eas/agents/codex-server.test.ts ./.eas/agents/codex-protocol.test.ts ./.eas/agents/qa-swarm.test.ts
bun .eas/agents/check-qa-workflow.mjs
bunx eas-cli@25.3.0 workflow:validate .eas/workflows/qa-swarm.yml --non-interactive
```

The protocol check regenerates schemas from the pinned binary in an empty temporary home. It also starts the real local app-server without credentials and confirms that an invalid per-thread shell policy reaches the config loader. It starts no model turn. The other tests use synthetic auth, a local GitHub HTTP fixture, real temporary Git repositories, fake cloud and Codex subprocesses, and real media decoding.

Coverage includes interleaved responses and notifications, notifications before acknowledgments, lane environment separation, malformed verdicts, failed or missing turns, final messages without completion, timeouts, cancellation, process exit, descendant cleanup, partial session startup, wrong embedded identity, missing media, auth failures, and no false PASS. EAS validation checks syntax and schema, not cloud permissions or behavior.

## Protocol evidence and remaining proof

The client uses stable generated `initialize`, `thread/start`, `turn/start`, and `turn/interrupt` methods. It consumes `turn/started`, `item/completed`, and `turn/completed` notifications. The pinned binary generates their schemas with `codex app-server generate-json-schema`. [OpenAI app-server documentation](https://learn.chatgpt.com/docs/app-server.md) describes the stdio handshake and lifecycle.

Pinned source shows the config path. `thread_start_task` calls `load_with_overrides`, and `ConfigManager` converts each request override into TOML before building the thread config. The shell policy accepts a `set` map, which shell execution uses to build its environment. [Thread processor](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server/src/request_processors/thread_processor.rs#L1398), [config manager](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server/src/config_manager.rs#L547), [shell policy](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/config/src/shell_environment_policy.rs), [execution environment](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/exec_env.rs).

The source also shows one `AuthManager` passed into `ThreadManager`, cloned into thread spawns, with a shared refresh semaphore. That supports the single-process design. Successful concurrent refresh and writeback remain a live proof obligation. [Message processor](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/app-server/src/message_processor.rs#L344), [thread manager](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/core/src/thread_manager.rs#L1385), [auth manager](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/login/src/auth/manager.rs#L2137).

Before presenting this as a working demo, the parent must retain evidence for the authenticated probe, the next run consuming persisted auth, capacity for three sessions, cold build and warm repack identity, real decodable media, exact installed embedded identity in every lane, scoped stop receipts, and graceful cancellation. The 30-minute demo timing, model entitlement, subscription refresh coordination in practice, remote path handling, and app journeys have not been established by this implementation task.
