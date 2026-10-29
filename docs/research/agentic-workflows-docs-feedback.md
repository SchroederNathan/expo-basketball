# Feedback on the draft Expo agentic workflow guides

Reviewed October 28, 2026. All five preview pages were fetched again and matched the earlier captured versions. This is feedback for the documentation authors based on implementing the examples in Lob for the PrizePicks demo.

**Recommendation.** Keep the four-workflow progression. Before publication, strengthen the examples around exact source selection, trustworthy results, and reruns. Provide one runnable reference project so readers can verify the complete path before adapting it.

## Fix or clarify before publication

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

These are integration observations, not additional defects attributed to the draft examples.

- **Verified on this account.** An EAS workflow's built-in Developer token started and stopped an owned simulator. A separate simulator robot token was unnecessary for that run. Add a permissions table explaining when the built-in token suffices and when a separate token is required. Avoid generalizing one account's access to every account. [Capability run](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a1858e-6307-7641-a748-393cfe598af0).
- **Verified build selection.** The first app build finished. The next workflow matched its native fingerprint and selected repack for a different candidate commit. This establishes the warm-path selection. Device acceptance and exported evidence were still pending when this note was written. [App rehearsal](https://expo.dev/accounts/exponathan/projects/expo-basketball/workflows/01a185bc-d5bf-7d2e-9d0e-100a71a3ea09).
- **Fixed in our runner.** A label containing spaces and equals signs needed quoting inside agent-device's selector language, even when passed as one process argument. Testing the pinned parser caught a bug that our fake device had missed. Include at least one executable controller/CLI contract test in the reference project.
- **Fixed in our auth validator.** Codex 0.165.0 supports `oauth_provenance` and `login_owner_id` metadata inside `tokens`. Our initial strict validator rejected a valid subscription file. The fix validates required credentials while preserving the original bytes. The fields are defined in OpenAI's [pinned TokenData source](https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/login/src/token_data.rs).
- **Optional authentication extension.** If the public guide supports managed ChatGPT subscription auth, link to OpenAI's [CI authentication guidance](https://developers.openai.com/codex/auth/ci-cd-auth/). Document refresh persistence and one credential owner per serialized stream. Parallel QA needs an explicitly supported topology. Our single-process App Server approach remains under test and should not yet be recommended as verified.

## Publication acceptance check

A fresh user should be able to run a known passing check, reproduce a seeded bug, generate its fix PR, verify the original criteria, and inspect all QA lanes. Repeat the issue event and simulate an agent timeout. Each report should retain the selected revision, installed artifact, evidence, and cleanup outcome without producing a false pass or overwriting someone else's work.

Update the implementation observations as cloud rehearsals finish. Replace preview links with the published URLs after release.

[intro]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/introduction/
[ci]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/agentic-ci/
[issue]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/issue-to-pr/
[qa]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/qa-swarm/
[triage]: https://pr-52087.expo-docs.pages.dev/agentic-workflows/bug-triage/
