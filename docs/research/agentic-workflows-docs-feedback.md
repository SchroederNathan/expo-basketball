# Feedback on the draft Expo agentic workflow guides

Draft observations use the five Expo preview pages captured on October 28, 2026 and their verified source snippets. Integration evidence was updated on October 29 from completed cloud audits. The pages were not fetched again for this update, so the draft observations apply to that captured version. The implementation lessons below describe our Lob runner, not defects newly attributed to Expo's drafts.

**Recommendation.** Keep the four-workflow progression. Before publication, strengthen the examples around exact source selection, trustworthy results, and reruns. Provide one runnable reference project so readers can verify the complete path before adapting it.

## Observations and recommendations for the captured drafts

### 1. Parse a complete verdict and distinguish execution failures

The Agentic CI result job accepts a verdict beginning with `PASS`. Its agent command also discards the process failure with `|| true`. The QA lane uses a different `PASS:` convention. These examples do not establish that a successful verdict came from a completed agent with the required evidence. [Agentic CI, workflow example][ci]. [QA Swarm, lane script][qa].

Use one small structured result contract across the guides. Require an exact verdict, successful process termination, required checks, and evidence files from the current attempt. Reserve `FAIL` for an observed acceptance failure. Report timeouts, invalid output, unavailable devices, and missing evidence as `INCONCLUSIVE`. Both states can fail a merge gate while explaining different next actions.

Keep artifact upload independent of agent success. Include a troubleshooting example where the agent exits successfully but omits its screenshot.

### 2. Carry the selected revision through every step

The Issue to PR script clones the repository's default branch, and its GitHub helper selects the default PR base. Choosing the workflow revision with `--ref` does not change those choices. Bug triage tests the default branch. In QA Swarm, a PR number selects a comment destination; it does not select the PR's source. [Issue to PR, change script and GitHub helper][issue]. [Bug triage, reproduction workflow][triage]. [QA Swarm, PR reporting][qa].

Either state the default-branch limitation prominently or add `target_ref` and a resolved SHA. Carry them through checkout, build/repack, PR base, device test, and report. For PR checks, verify the current PR head before posting a result.

Show a small identity record containing candidate SHA, native source build, installed build, fingerprint, runtime, environment, and session. Identify a repack as an embedded candidate bundle. It does not demonstrate an OTA download or activation.

### 3. Make Issue to PR reruns preserve existing work

The sample uses a fixed temporary directory, an issue-number branch, and an unconditional `git push --force`. An existing PR is reused by its head branch. [Issue to PR, change script and GitHub helper][issue].

Use a directory per attempt and concurrency scoped to the issue and target branch. Verify the existing branch's ownership, ancestry, and PR base before updating it. Use normal fast-forward pushes for the default path. Report a conflict when another actor has advanced the branch. Upsert a marked issue comment so repeated label events produce one current status.

Install dependencies from the selected checkout's lockfile. The sample's `node_modules` symlink can otherwise test a release branch with dependencies from the controller checkout.

### 4. Turn the existing trust warning into an executable setup

The draft already warns that agents can access worker credentials and that PR code can modify the runner. Preserve that warning. The Codex runner's `device`/`change` argument does not enforce tool restrictions, so prompt instructions should not be presented as permissions. [Agentic CI, agent runners and limitations][ci].

Add a trusted same-repository PR example and explain the fork path. Document how the workflow controller is reviewed or pinned. Put GitHub mutations and final validation in controller code, with unrelated release credentials outside the agent environment. Explain that removing environment variables does not create a security boundary on the same worker.

### 5. Explain evidence visibility and cleanup at the point of use

The QA example deploys an evidence site through `eas-simulator-evidence` with a reusable alias. The guide discusses public Hosting and alternatives, but readers encounter the deployment inside the lane script. [QA Swarm, evidence publishing][qa].

Make artifact-only reporting the initial example, or put the public-access explanation directly beside the command. Prefer immutable run URLs, with an optional alias for the latest result. Distinguish a recording, a live session, and the link that starts a new session for the same build.

Include partial-startup and cancellation recovery. Record the owned session ID as soon as it is available, scope cleanup to that session, and confirm its stopped state. A maximum duration is a backstop rather than proof of cleanup. Account for evidence export also stopping a session.

## Additions that would shorten setup

| Guide | Suggested addition |
| --- | --- |
| [Introduction][intro] | A five-minute preflight covering simulator access, platform support, a compatible app build, agent authentication, and artifact access. Show a completed report early. |
| [Agentic CI][ci] | A tested version matrix and a runnable fixture app. State which behavior is checked by the agent, which facts the controller verifies, and which release decisions remain separate. |
| [Issue to PR][issue] | Carry the original issue's acceptance criteria into CI. A generated PR description should supplement the criteria. Add examples for no change, forbidden edits, an existing PR, and a conflicting branch. |
| [QA Swarm][qa] | Document the credential topology for parallel agents, lane timeouts, partial results, and concurrency limits. Require every expected lane to appear in the final report. |
| [Bug triage][triage] | Put the default-branch limitation beside the intake command. For TestFlight, record the reported artifact and deduplicate feedback by stable ID before creating another issue. Explain how to interpret a non-reproduction on a different build. |

The guides duplicate runner and session helpers. Generate those snippets from a tested reference implementation so fixes reach every page. Validate each platform/provider combination that is presented as runnable, including one timeout and one missing-evidence case.

## Findings from this implementation

These are integration observations, not additional defects attributed to the draft examples. All four Lob workflows now have cloud evidence. Original triage and coding proof remains historical. CI and QA have separate final-head PASS evidence. See [the demo evidence record](../prizepicks-demo.md#current-evidence) for exact revisions and scope.

- **Verified on this account.** An EAS workflow's built-in Developer token started and stopped an owned simulator. A separate simulator robot token was unnecessary for that run. Add a permissions table explaining when the built-in token suffices and when a separate token is required. Avoid generalizing one account's access to every account. [Capability run](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a1858e-6307-7641-a748-393cfe598af0).
- **Distinct persistence permission.** Actual probes returned `Not authorized` when the built-in Developer and Release Manager tokens tried to update the subscription Secret file. Simulator access did not imply environment-variable write access. Document these capabilities separately and verify refresh persistence before running an agent with subscription auth. [Developer probe](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185c2-3b12-70c5-bef3-f0bf0e091464). [Release Manager probe](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185c4-73bc-7068-8b28-2270d245c514).
- **Verified resolution.** A dedicated persistence credential successfully updated the actual Secret file from an EAS worker. Later authenticated CI and QA also recorded persisted writeback. No audit established token rotation. [Successful writeback probe](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185d5-ded3-7343-abbd-38232fbcc009). [Final QA](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18906-9946-7962-b6db-962f825ffb27).
- **Explain conservative fingerprint changes.** Comparing the first and integrated revisions showed only `packageJson:scripts` changed, specifically the expanded `check:agents` command. That changed the fingerprint and selected a full native build. Include a fingerprint-diff example so readers can explain the cache decision without assuming a native dependency changed. Preserve the default compatibility gate unless a narrower exclusion has been justified and tested.
- **Test isolated simulator directories with the real config loader.** Our next cold build succeeded and credential persistence passed, but simulator startup failed before Codex began. Copying the full app config into a temporary directory without dependencies made EAS try to resolve `expo-router` there. The pinned EAS loader reproduced the error locally. A minimal config containing the existing project identity resolves without app plugins, and the subsequent cloud retry passed. [Cold-build rehearsal](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185dc-cb77-7d48-b9c9-e646eda0f531).
- **Historical manual Agentic CI.** The retry passed all three baseline journeys with exact artifact identity, five PNGs, complete MP4 decoding, persisted-auth and scoped cleanup receipts. This establishes the manual baseline path at `25e6adc8bb2097d3832304d3895f52ca75d684d5`. Include a similar evidence checklist in the reference implementation. [Passing rehearsal](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185ea-35e7-7406-93dc-19648335a00e).
- **Check recording timestamps as well as decoding.** That recording decoded all 1,584 frames, but one presentation timestamp jumped backwards. Decoder success did not establish smooth chronological playback. Preserve raw evidence and separately check presentation playback before recommending a clip for sharing. This observation does not identify which recording component introduced the discontinuity.
- **Constrain evidence filenames in the output schema.** Our first triage run observed the seeded label failures, but its structured response used placeholder PNG names. Evidence admission correctly returned INCONCLUSIVE, and the workflow posted that state to GitHub. Restrict screenshot basenames to the known check IDs and validate their pairing in the controller. A prompt naming the files was insufficient in this run. [Triage rehearsal](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185f6-d87e-75e5-ac52-e7b629bca36a).
- **Manual app proof.** A separate remote baseline check confirmed the fixed scores, game detail, Avery's labels, and preserved search state. It reproduced Jordan's blank labels, downloaded real screenshots and a decodable recording, and independently confirmed session stop. This validates the demo scenario and remote transport. It is not proof that the automated Codex workflow passed. [Manual session](https://expo.dev/accounts/exponathan/projects/expo-basketball/simulator-sessions/01a185cf-7a21-772c-a879-d1ee34dff707).
- **Earlier build-selection proof.** The first app build finished. The next workflow matched its native fingerprint and completed repack for a different candidate commit. The controller then stopped at its initial credential writeback check and returned `INCONCLUSIVE`, which failed the final gate. No simulator or coding agent started at that checkpoint. Later rehearsals separately proved persistence and device acceptance. [First app rehearsal](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185bc-d5bf-7d2e-9d0e-100a71a3ea09).
- **Fixed in our runner.** A label containing spaces and equals signs needed quoting inside agent-device's selector language, even when passed as one process argument. Testing the pinned parser caught a bug that our fake device had missed. Include at least one executable controller/CLI contract test in the reference project.
- **Fixed in our auth validator.** Codex 0.165.0 supports `oauth_provenance` and `login_owner_id` metadata inside `tokens`. Our initial strict validator rejected a valid subscription file. The fix validates required credentials while preserving the original bytes. The fields are defined in OpenAI's [pinned TokenData source](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/login/src/token_data.rs).
- **Optional authentication extension.** If the public guide supports managed ChatGPT subscription auth, link to OpenAI's [CI authentication guidance](https://developers.openai.com/codex/auth/ci-cd-auth/). Document refresh persistence and one credential owner per serialized stream. Our [single-process App Server probe](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18610-217b-7052-85a2-5efc365bdb56) verified three authenticated overlapping threads, separate shell environments, a healthy exit, and auth persistence on Linux. Final QA separately proved the remote journeys. Token rotation and simultaneous refresh remain unproved. This demo retains the operator-authorized public repository. Trusted worker code is not isolated from credentials by per-thread environment maps.

- **Verify real checkout history.** Our first PR-triggered run stopped at frozen-base ancestry. The documented EAS checkout input is `ref`; `fetch_depth` was unsupported and did not provide parent history. The runner now fetches missing history before proving ancestry and checks that HEAD remains the selected candidate. Local depth-one clone regressions cover valid and forged ancestry. See [the checkout contract](https://docs.expo.dev/eas/workflows/syntax/#eascheckout).

- **Historical issue-to-device chain.** Real label events reproduced the seeded bug at `34b46867681fd283c9247e67be4bf54ae3db8611` and opened a four-file app patch at `8aa8179391a149b84291b2e9759799b35a8aa398` in [PR 4](https://github.com/SchroederNathan/expo-basketball/pull/4). A [duplicate dispatch](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18622-5405-7eeb-8da2-23c3d2c83e35) reused that PR without loading auth. After a controller upgrade, [automatic acceptance](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18628-d68d-7b13-8993-694ec0b78eac) passed the original criteria at `82c8a69490e0b4786f99d8cd70d86008cb0c12cd`. Preserve the original contract through upgrades. After a human merge, repeat the coding exercise with a fresh issue on a reviewed seeded target, not by resetting the old issue or branch.

- **Retain the failed command, not only a broad stage.** In the [first full QA rehearsal](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18629-156f-7749-b2c7-6a1f75885b7c), three owned sessions started, but two lanes stopped before their agent threads. One lane passed. Our combined startup message discarded which command failed and why. The runner now records the operation, termination, and bounded redacted failure output while preserving cleanup and auth outcomes. An INCONCLUSIVE verdict should contain enough information to choose the next diagnostic step.

- **Separate observation from a launcher hypothesis.** A [later diagnostic run](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18644-5bbc-7d1a-8204-857d7380c444) retained two Bunx failures before agent-device opened the app. Scores reported a package cache-to-destination copy failure. Search-back could not determine the package executable. Those messages establish a launch failure, not a proven cache race. Do not name an underlying mechanism without evidence that distinguishes it.

- **Prepare pinned tools before concurrent lanes.** Our [helper](../../.eas/agents/qa-tools.ts) installs a dedicated frozen tool lockfile once, verifies package locations and exact tool versions, and supplies absolute installed commands plus a device shim. Lanes use separate homes and device state without per-action package resolution. The [Linux probe](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a188f9-909d-7cea-9743-4e918e4fc382) at `d984d14a377b21d1d21e314e74d4635c9e15687c` passed all eight outcomes. Preparation took 4,617 ms within its 120,000 ms budget. Three isolated lane probes passed with package-manager sentinels on PATH. This tools-only proof started no model or remote device.

- **Preserve an unknown cause after a successful retry.** The [earlier Linux probe](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a188ec-1399-7cb5-8c89-7728526a5039) was INCONCLUSIVE at prepared EAS `--version`, with no child termination or stderr details. Its cause remains unknown. New bounded preparation diagnostics retain termination, version-match, stderr classification, and cleanup status. A later PASS does not prove that an earlier dependency, cache, or runtime fault occurred.

- **Require full QA evidence after a tools-only pass.** The [prepared-tools cloud rehearsal](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a188fc-a9d6-7ed5-9285-10dd8527afe9) passed at `758efdd896db2f2f2cd6bd104a4f36b0226fa29c`. It had three distinct sessions and completed turns with 41.572 seconds of common overlap, nine PNGs, and 1,917 decoded frames. Independent reads confirmed all sessions STOPPED. Auth persisted, and the server exited healthily. Its duplicate timestamps prevent a strictly increasing timing claim even though no backward jump was found.

- **Verify the final PR revision separately.** [Final CI](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18906-6503-7785-8de9-f9d00384177e) and [final QA](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a18906-9946-7962-b6db-962f825ffb27) passed at `705a42333c551953d62cf9c54156c2e17b2363bf`. CI checked the four original issue criteria. QA checked three generic journeys with 51.629 seconds of common turn overlap. The audit recorded all 15 PR checks green, four independently STOPPED sessions, persisted auth, and healthy QA server shutdown. The combined media audit decoded 15 PNGs and 3,460 frames. QA search-back regressed by 1.667 ms at zero-based frame 259, so strict chronology failed. Final QA recording visual sampling stopped there. Retain that limitation beside the PASS, and do not reuse the earlier rehearsal as final-head proof.

- **Separate native reuse from release policy.** The final artifacts use runtime `1.0.0` under Lob's `appVersion` policy. Fingerprint lookup selected compatible native builds for repack. It did not implement PrizePicks' planned fingerprint runtime policy or prove OTA activation or production rollout. Keep those distinctions beside the build diagram. See [the release-context research](prizepicks-release-context.md).

## Publication acceptance check

A fresh user should be able to run a known passing check, reproduce a seeded bug, generate its fix PR, verify the original criteria, and inspect all QA lanes. Repeat the issue event and simulate an agent timeout. Each report should retain the selected revision, installed artifact, evidence, and cleanup outcome without producing a false pass or overwriting someone else's work.

Keep each observation attached to its exact run and revision. The four Lob workflow paths are demonstrated. Live cancellation recovery and production rollout remain outside this evidence. Replace preview links with published URLs after release and recheck the examples before applying these draft recommendations to a newer version.

[intro]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/introduction/
[ci]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/agentic-ci/
[issue]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/issue-to-pr/
[qa]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/qa-swarm/
[triage]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/bug-triage/
