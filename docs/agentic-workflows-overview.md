# How the agentic workflows work

The demo follows one bug from report to a tested pull request. Agents reproduce the bug, propose a fix, and test the app. EAS provides the builds, workflow jobs, remote iOS simulators, and evidence artifacts. You review the result and decide what ships.

Start with this overview. Use the [operator runbook](agentic-workflows.md) for commands and credentials, or the [30-minute presentation guide](prizepicks-demo.md) for the talk.

## The complete story

1. Someone reports that Jordan Vale's stat tiles have missing labels.
2. **Bug triage** opens the selected app and checks whether the bug happens.
3. A person applies the `agent` label. **Issue to PR** changes the code and opens a pull request.
4. **Agentic CI** tests that PR against the original issue criteria on a remote iOS simulator.
5. **QA Swarm** tests three nearby journeys concurrently.
6. A person reviews the patch and evidence before making a release decision.

Triage and coding are separate actions. A triage result does not automatically start a fix. QA Swarm is currently a separate manual dispatch bound to the PR.

## 1. Bug triage: can we reproduce it?

**Start:** Apply `agent-triage` to a supported issue, or dispatch the triage workflow manually with an issue number and exact target commit.

The GitHub label bridge checks the issue and labeling actor, resolves the configured release branch to a commit, and dispatches EAS. EAS verifies that source and prepares an app artifact containing that commit's JavaScript.

The agent opens the app on an owned remote iOS simulator and walks through the original issue criteria. For Jordan, it checks the historical points label, the unknown-stat fallback, Avery's existing labels, and search/back navigation. It captures screenshots while the controller records the session.

The controller validates the evidence, stops the simulator, persists subscription auth, and posts a result on the issue.

- **REPLICATED:** The agent observed the reported failure with the required evidence.
- **NOT_REPLICATED:** All original checks passed on this particular artifact.
- **INCONCLUSIVE:** The run could not establish either result, for example because a device or evidence step failed.

**You review:** The issue comment, screenshots, recording, and tested source. Triage does not edit the app or close the issue.

Source: [bug-triage.yml](../.eas/workflows/bug-triage.yml). Setup: [issue label bridge](agent-label-bridge.md).

## 2. Issue to PR: propose the fix

**Start:** Apply `agent` to a supported issue, or dispatch the coding workflow manually.

The controller freezes the target commit and original acceptance criteria. The coding agent works on that source and can edit only the permitted app paths. In this demo, it fixes Jordan's missing stat labels while preserving existing player stats and navigation.

The controller checks the patch, runs the required local checks, and verifies that the target has not moved. It pushes a normal commit to its owned branch and opens or reuses one PR. The original criteria travel with the PR so downstream CI tests the reported problem.

- **PR_READY:** A patch passed the controller's local checks and was published for review.
- **NO_CHANGE:** The agent explicitly reported no change and left no source diff.
- **REJECTED:** The proposed patch exceeded the allowed scope.
- **INCONCLUSIVE:** Execution or publication did not produce a reliable result.

**You review:** The code diff and check results. PR_READY does not mean the app has passed device acceptance yet. Agentic CI supplies that next proof.

A duplicate request can reuse the original owned PR. After a person merges other commits into that branch, use a fresh issue for another demo. Re-labeling the old issue is not a reset.

Source: [issue-to-pr.yml](../.eas/workflows/issue-to-pr.yml). Details: [coding runbook](agentic-workflows.md).

## 3. Agentic CI: does this exact PR work in the app?

**Start:** A supported trusted same-repository PR event, or a manual dispatch with an exact candidate commit.

EAS prepares the candidate app. The controller verifies the installed build and the app's embedded source identity before the agent starts testing. An issue-generated PR uses the original four issue checks. A generic baseline run uses the three baseline journeys.

The agent interacts with the real remote app and captures evidence. The controller checks the verdict, screenshots, recording, source identity, auth persistence, and session cleanup before posting the PR result.

- **PASS:** Every required check passed with complete evidence.
- **FAIL:** An acceptance check failed with complete evidence.
- **INCONCLUSIVE:** The run lacks enough trustworthy evidence to decide.

Both FAIL and INCONCLUSIVE fail the workflow gate. An agent writing “PASS” or exiting successfully is insufficient.

**You review:** The PR verdict and linked evidence. This is the step that proves the proposed code fixes the original issue on the installed candidate.

Source: [agentic-ci-ios.yml](../.eas/workflows/agentic-ci-ios.yml).

## 4. QA Swarm: did nearby journeys still work?

**Start:** Manually dispatch QA with the candidate branch and commit. Include the PR number to bind the run to that PR head.

One controller prepares the pinned tools once, then starts one Codex app-server with three threads. Each thread gets its own remote simulator, working directory, device state, and evidence directory.

The lanes cover separate journeys:

- **Scores:** Open the fixed game, check the score, and inspect its leaders.
- **Current player:** Search Avery and check the existing stats and accessibility labels.
- **Search and back:** Search Jordan, open the profile, and confirm Back preserves the query and result.

The controller requires all three completed turns to overlap. It collects every lane's screenshots and recording, stops all owned sessions, persists auth, and publishes one aggregate result. Three fully evidenced passes produce PASS. An observed acceptance failure produces FAIL; incomplete execution produces INCONCLUSIVE.

**You review:** Each lane's evidence and the combined verdict. QA Swarm adds coverage around the fix. It does not replace the original issue acceptance check.

Source: [qa-swarm.yml](../.eas/workflows/qa-swarm.yml). Details: [QA Swarm runbook](qa-swarm.md).

## How EAS chooses the app to test

Every device workflow follows the same native-artifact decision:

1. Compute the candidate's native fingerprint.
2. Look for a compatible `agent-preview` iOS simulator build.
3. If one exists, **repack** it with the candidate's JavaScript.
4. Otherwise, create a new native build.
5. Verify the installed artifact and embedded candidate identity before testing.

A repack produces a simulator artifact. It does not publish an OTA update. These demos use the `preview` environment, `agent-preview` channel, and runtime `1.0.0` under the `appVersion` policy.

PrizePicks' planned pipeline uses fingerprint runtime versions and staging-to-production promotion. This demo shows how agent evidence could support that release decision. Production OTA rollout, rollback, Sentry monitoring, store submission, and release scheduling are outside the demonstrated workflows.

## What the agent owns and what the controller owns

The agent interprets the issue, proposes permitted code changes, or explores the app. The controller selects source, enforces allowed paths, owns credentials and sessions, runs checks, validates evidence, publishes results, and performs cleanup.

The workflows use subscription authentication with one serialized credential stream. QA's three threads share one app-server within that stream. This is trusted automation on one worker, not isolation from hostile code.

Two supporting probes check infrastructure separately. The subscription probe checks concurrent authenticated threads. The Linux tools probe checks a fresh pinned installation and direct executable launches. Neither probe proves app behavior.

## What is ready for the presentation

All four workflow paths have cloud evidence. CI and QA passed on PR #4 commit `705a423`; triage and coding have earlier recorded runs that establish the issue-to-fix story. The [presentation guide](prizepicks-demo.md#current-evidence) lists exact runs and their scope.

Keep the seeded baseline and repaired PR separate. Use the completed evidence during the talk and treat a new live run as optional. Cloud timing is not guaranteed to fit a presentation segment.

All final recordings decoded. One QA recording has a small backward timestamp jump, documented beside the evidence. Preserve original media and label any retimed presentation copy as edited playback.
