# Device evidence comments

CI, triage, and QA use one controller publisher after their cleanup and subscription finalizers. The observed `result.json` stays unchanged. A separate delivery receipt records verified asset URLs, hashes, the exact comment ID, the writer ID, and GitHub rendering signals.

A PR destination or triage issue makes publication required. `status.json` reports `INCONCLUSIVE` when delivery is partial or unavailable and preserves the device verdict in `observed_state`. Manual checks and QA without a destination retain artifacts only. CI's existing bot comment links the new evidence comment. The publisher never edits the bot's comment, the PR body, or its original acceptance receipt.

## Admission and playback

Only controller-admitted references enter publication. The publisher reopens regular files without following symlinks, rejects hard links and unsafe paths, checks byte counts and SHA-256, and stages private copies. Neighboring files and logs are excluded. Each check and QA lane keeps its own caption, even when screenshots have identical bytes.

PNG evidence appears inline. Each recording has an unchanged original download and a derived H.264, yuv420p playback copy. Playback preserves every decoded frame in order, scales to 604 pixels wide, and normalizes timing to 15 fps. Captions call this edited playback. It does not prove original chronology or elapsed time. Every attachment must fit below 9,500,000 bytes. A derivation or size failure leaves publication unavailable and retains the observed result.

When FFmpeg supports `setpts:strip_fps`, derivation clears inherited frame-rate metadata. Older capabilities use a decoded raw-pixel FIFO and a fresh 15 fps encoder input. Decoder frame indexes, output frame count, normalized PTS/duration, byte caps, and original hashes remain required in both paths.

The controller prepares official `gh` 2.103.1 before model or device work. Archive and binary SHA-256 pins cover Linux AMD64 and macOS ARM64. Preparation uses the existing `AGENT_GITHUB_WRITE_TOKEN`, verifies public-repository push access, and checks both comment attachment commands. A synthetic encode/decode canary verifies the actual playback pipeline before expensive work. No writer credential enters a model environment.

## Reconciliation

Each attempt has an immutable manifest marker. The publisher lists comments with bounded pagination and rejects duplicate, foreign, altered, or conflicting markers. Native creation runs once per recorded intent. Every exit, including failure, is reconciled through GitHub before another write.

Already verified URLs are reused. At most two recovery comments upload missing slots. The controller patches the canonical comment by exact numeric ID and removes unresolved local placeholders. Anonymous downloads must match admitted hashes. A complete receipt also requires image and native-video tags in GitHub's rendered HTML. The public card stays partial until anonymous hashes, rendered media, and the live destination pass. The controller rereads the head/ref/repository or issue input immediately before every create, recovery create, and status PATCH. A changed or unverified destination after an issued write is reconciled to an exact owned stale/partial comment, preserving the recorded device verdict. Historical backfills keep their old-source semantics. Browser inspection remains an independent acceptance step.

Writer preparation shares a 120-second deadline. Publication shares a five-minute deadline across staging, media commands, gh, GitHub requests, and anonymous downloads. SIGINT/SIGTERM stops new uploads. Issued writes get a separate ten-second budget for marker reconciliation and exact-ID partial/stale finalization. Durable intents and append-only `publication-{manifest,intent,invocation,receipt}-*.json` files survive staging cleanup. If GitHub remains unreachable, those receipts require operator reconciliation; the publisher cannot guarantee a remote correction during an outage.

Keep the publication intents, manifests, and receipts with the retained EAS artifacts. Reuse the same receipt directory for a historical retry. An intent without a reconciled owned comment is ambiguous and stops automatic creation. Resolve that condition through exact marker inspection before any manual recovery. The serialized workflow queue remains required.

## Historical commands

`evidence-history.ts` accepts only four audited sets from `evidence-history.json`. It pins the entire archive and original result, checks original member windows and referenced bytes, and verifies source criteria and fixture hashes against local Git objects. Historical labels and original timing limitations stay in the comment. The sole schema migration adds the missing run URL to the exact pinned historical QA result.

```sh
bun .eas/agents/evidence-history.ts import ci-pr4 /path/to/retained/archive /path/to/receipts
bun .eas/agents/evidence-history.ts publish ci-pr4 /path/to/retained/archive /path/to/receipts
```

`import` verifies locally and writes an audit receipt. `publish` requires the existing trusted repository writer environment. The other set IDs are `qa-pr4`, `triage-original`, and `triage-repaired`. No command accepts an arbitrary result directory as trusted evidence. Neither command starts a device or model, changes live freshness admission, updates criteria, or asserts a verdict for the current head.

## Credential-free runtime probe

Run the shared version/help and real media canary checks against an existing checksum-pinned binary in the target runtime. This command uses temporary isolated configuration and makes no network request.

```sh
env -i PATH="$PATH" bun .eas/agents/evidence-compat.ts /path/to/pinned/gh
```

A macOS result does not establish Linux compatibility. The small canary also does not replace verification of the retained recordings or real anonymous browser playback.
