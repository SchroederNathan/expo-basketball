# PrizePicks release context

Internal research, October 28, 2026, for the 30-minute Lob presentation. Evidence is separated below. The [agentic workflow research](prizepicks-agentic-workflows.md) covers the unreleased Expo guides. This note uses static file inspection and the public article. No tests, deployments, builds, device interactions, installations, or remote mutations were performed.

## Public PrizePicks article

- Live: required PR unit/type/lint/cycle checks and Maestro smoke; manual JS hotfixes and human Sentry/rollback decisions. Only the first gate operates today. [Article](https://labs.prizepicks.com/continuous-deployment-for-react-native-when-you-cant-break-on-game-day/)
- Planned: fingerprint routing, scheduled same-day OTA, full-suite deploy validation, Sentry tagging, and automatic rollback. Three daily windows and `/deploy-now` are goals; weekdays are unspecified. [Article](https://labs.prizepicks.com/continuous-deployment-for-react-native-when-you-cant-break-on-game-day/)
- Tracking synchronizes the live release with main. Divergence freezes that train for compatible cherry-picks while another enters native review; its release resumes tracking. Persistent release branches support older-build backports. [Article](https://labs.prizepicks.com/continuous-deployment-for-react-native-when-you-cant-break-on-game-day/)
- OTA requires compatible installed native code. Proposed CI checks cherry-picks against the live train; backend contract checks remain unbuilt. Backend skew previously caused incorrect entry labels for almost two days. [Article](https://labs.prizepicks.com/continuous-deployment-for-react-native-when-you-cant-break-on-game-day/)
- Planned rollback compares new/predecessor cohorts using crashes, caught errors, and journey completion; shared backend incidents should affect both. Thresholds/sample sizes need calibration. Native failures require OTA mitigation or expedited review. [Article](https://labs.prizepicks.com/continuous-deployment-for-react-native-when-you-cant-break-on-game-day/)
- A second native change could resubmit the pending train or queue another with parallel review. That controller remains undecided. This conflicts with the supplied per-platform review limit. [Article](https://labs.prizepicks.com/continuous-deployment-for-react-native-when-you-cant-break-on-game-day/)

## User-supplied plan

Source: the task brief, internal and unpublished; no URL supplied. Its requirements are shadow-mode automation, staging with the preview EAS environment followed by production re-bundling, one shared channel per environment, fingerprint runtimes, one in-review native build per platform, a sole production promotion gate, and three weekday windows.

Treat these as intended design. The review limit implies that a later train must wait for that platform's review slot instead of starting a concurrent review. This is an inference from the supplied constraint. Do not present the article's parallel-review option as the agreed plan, or its three daily windows as a published weekday commitment.

## Observed Lob state and gaps

| Area | Repository evidence and implication |
| --- | --- |
| Stack and identity | Expo `~58.0.19`, React Native `0.88.0`, and `expo-updates ~58.0.18`; EAS CLI is pinned to `25.3.0`. Owner, project ID, update URL, and native identifiers are configured. [package.json](../../package.json), [app.json](../../app.json) |
| Runtime compatibility | Uses `appVersion`, currently `1.0.0`, rather than fingerprint runtimes. The guide requires an app-version bump and new binary for native changes; build-number increments alone do not change this runtime. This is a setup gap against the supplied plan. [app.json](../../app.json), [EAS Update guide](../eas-update.md#compatibility-and-testing) |
| Channels and environments | Development, preview, and production each have a matching channel/environment pair, consistent with one channel per environment. Same-name remote branch mappings are documented historical observations, not freshly verified remote state. [eas.json](../../eas.json), [verification record](../verification.md#eas-update-setup-checks) |
| Promotion and automation | Separate `eas update` scripts select each environment and both platforms. The guide requests deliberate production publishing after preview validation. The inspected files define no enforced sole promotion gate, staging-to-production re-bundling procedure, shadow controller, weekday scheduler, train/backport automation, store-review serialization, or cohort rollback controller. Separate publish commands do not establish equivalent preview/production behavior. [package.json](../../package.json), [eas.json](../../eas.json), [publish guide](../eas-update.md#publish) |
| Deployment proof | Setup records report channels/branches and generated native update configuration, but no published update or cloud build. Existing clients need rebuilding; OTA download/activation remains untested. The documented cold-launch behavior is an expectation, not an observed deployment result. Hosted builds, store submissions, production promotion, backports, and rollback are not demonstrated by these records. [EAS Update guide](../eas-update.md#compatibility-and-testing), [verification record](../verification.md#eas-update-setup-checks) |
| Validation limits | The October 26 record reports passing static/unit/export checks and local iOS development-build interaction. Android interaction, live-game transitions, and real notification delivery remain unverified. Existing API checks do not establish release/backend-skew compatibility or production rollout safety. No checks were rerun for this note. [verification record](../verification.md) |

Presentation implication: Lob can illustrate the configuration and proposed release decisions. Its current evidence does not support claiming a working production release controller or a verified OTA deployment.
