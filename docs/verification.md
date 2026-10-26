# Verification record

Checked on October 26, 2026 with an iOS 26.5 simulator and a local development build. Native projects are generated from app config. No hosted build, store submission, or deployment was performed.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run check` | TypeScript passed, 38 tests passed, public-file checks passed. |
| `npm run check:api` | Typed parsing passed for four scoreboards, all nine NBA endpoints, and standings, teams, and one roster for each other league. |
| `npm run export` | iOS, Android, and web bundles passed. Web static rendering completed for all routes. |
| `npx expo-doctor` | All 20 checks passed. |
| `npx react-doctor . --verbose` | No errors and four reviewed warnings. See the [review record](verification/review.md). |
| Xcode Debug simulator build | Succeeded with the gradient and application modules, then installed. See the [native build receipt](verification/ios-icon-build.json). |

The tests cover calendar validation, daylight saving, polling policy, league-pinned entity links, API failures and mismatched responses, plays and standings views, cached refresh failures, offline content, push payloads, and preference drafts. They do not prove native notification delivery.

The API check used completed NBA game 401909861, Lakers 132 to Jazz 123, and parsed 451 play items. No live game was present during the checks. Today's scoreboard returned nine NBA games and one WNBA game, all upcoming, and empty college scoreboards. The earlier [HTTP receipt](verification/api-checks.json) records reachability only; the later typed check validates the responses.

## Native interaction

| Flow | Observed result |
| --- | --- |
| Scores and dates | Real upcoming and completed games loaded. Date-strip taps and a horizontal day swipe selected the corresponding day. |
| Distant calendar date | The graphical native calendar selected September 20, beyond the initial paging window, and showed its empty scoreboard. Today returned to October 26. |
| Game details | Final score, gradient, flow, linescore, leaders, and native section controls rendered. [Screenshot](verification/screenshots/game-box-score.png). |
| Box score | Player names and stat rows align after resolving linked-row styles. The fixed name column remains beside the horizontally scrolling stats. |
| Plays | The completed game opened on its latest period. Selecting Q1 changed the visible feed to first-quarter plays. |
| Teams and history | NBA teams opened Boston's profile. An upcoming schedule row opened its game, and Back returned to the team within the Teams tab. |
| Standings | WNBA Eastern and Western filters showed distinct correct teams. College standings rendered a native conference selector and America East teams. [Screenshot](verification/screenshots/standings.png). |
| Leaders and player | Changing from points to assists changed the leader list. Trae Young opened with biography, averages, rankings, and recent games. [Screenshot](verification/screenshots/player.png). |
| Search | The native input returned Stephen Curry for curry, opened his profile, and retained the query on Back. An unmatched query showed a useful empty state. |
| Missing entity | A cold link to an unknown NBA team showed the missing-team screen. [Screenshot](verification/screenshots/missing-team.png). |
| Notifications | The header action opened the unsupported-build message and Done returned to Scores. No notification service is configured. [Screenshot](verification/screenshots/notifications.png). |
| Development overlay | The floating tools button no longer intercepts trailing header actions after cold launch. Metro can still open the developer menu. |

Runtime checks found and fixed linked style loss, early native push imports, a compiler-incompatible retry loop, and the development overlay collision. The [diary](diary/2026-10-26-native-verification.md) explains the causes. The [decision trail](decisions.tsv) records the choices.

## Not verified

- Android runtime interaction. No Android emulator was listed by the available device host.
- Physical iPhone push delivery, tapped-push navigation, and service registration recovery. These require a signed device build and a notification service configured for this app identifier.
- Live-game polling and period transitions against a live response. Polling policy and period selection have behavior tests, but no live game was available.
- Release animation performance, VoiceOver traversal, the largest Dynamic Type sizes, tablet layouts, and a device time-zone change while the app remains open.
- Web browser interaction. Bundle export and static rendering passed; those checks do not exercise browser input.

The install still has transitive Expo CLI advisories described in the [development diary](diary/2026-10-26-development-build.md). A forced SDK downgrade was not applied. No performance claim follows from a successful development build or a React Doctor score.
