# iPhone Duo safe-area verification

Checked October 28, 2026 with the current Expo SDK 58 development client on local and EAS iPhone Duo simulators running iOS 27.1. Both simulators loaded this worktree's JavaScript through a dedicated Metro server.

## Findings and changes

The Duo reports an 84-point right safe-area inset for its system rail. The original vertical lists still laid out their content across the full 466-point outer window. Team logos, trailing values, date cells, filters, and detail content could sit under the rail. Changing scroll inset adjustment alone did not constrain that content width.

The shared `Screen` component now applies the left and right safe areas to every route's content. Native headers and automatic scroll insets retain responsibility for vertical space. The score pager measures its actual viewport instead of assuming the full window width, and its iOS tab leaves automatic inset overrides disabled for that horizontal pager.

At the resulting 382-point outer content width, standings now choose the columns that fit while reserving room for team names. Three-digit game scores can shrink within their center column instead of overlapping the team logos.

- [Scores before the fix](screenshots/duo-scores-before.png)
- [Scores after the fix](screenshots/duo-scores-after.png)
- [Compact standings](screenshots/duo-standings.png)
- [Completed game](screenshots/duo-game.png)
- [Selected date preserved after reopening](screenshots/duo-folded-date-preserved.png)

## Coverage

Every route was exercised on the outer and inner displays, including all four league layouts: NBA, WNBA, men's college, and women's college. The observed app windows were 466 × 678 points closed and 951 × 669 points on the inner display. EAS verified hinge angles of 0°, 130°, and 180° for closed, half-open, and open poses.

| Area | Variants checked |
| --- | --- |
| Scores | All leagues, populated and empty days, date strip, native calendar, horizontal paging and date changes |
| Teams | Pro division groups, college alphabetical lists, team details, schedules, results, and rosters |
| Standings | Eastern, Western, divisions, and college conference layouts; compact and wide tables |
| Players | All six leader statistics, all leagues, player detail, stats, recent games, biography, and missing images |
| Search | Initial prompt, loading, populated results, unmatched query, and keyboard-visible layout |
| Game | Upcoming and final, Box Score, both teams, Plays, period selection, Standings, and bottom-of-content access |
| Notifications | Unsupported build, loading, error, unregistered, denied, and registered forms for all four leagues; sheet presentation and bottom controls |
| Fallbacks | Invalid game, team, and player links, plus an unknown route |
| Data states | Loading, failed, offline, cached refresh failure, and empty content for the seven non-search data screens |

The fallback states and notification forms used temporary fixtures in an isolated development runtime. They did not change production code or contact a notification service. Notification delivery and registration were not tested. No live game was available; upcoming and completed responses supplied the game layouts.

The closed-display accessibility captures included 74 React Native scroll views. Their content viewports stayed within the horizontal safe area. Native modal sheets use their own window geometry and were checked separately. A horizontal swipe changed the score header and selected date from October 28 to October 29.

The EAS half-open pass captured all 35 route and league cases. A subsequent half-open → open → closed → open sequence preserved October 29 and kept its score rows aligned with the resized viewport.

The first EAS session became unresponsive during the inner-display pass and was replaced. After pose changes, the controller sometimes required a fresh snapshot or app relaunch to recover its window geometry. Screenshots and the accessibility tree were reacquired before continuing.

A larger Dynamic Type pass could not finish because the local simulator's XCTest runner stopped launching. Its original text-size setting was restored. This pass does not claim validation of larger text sizes, physical-device push delivery, or live-game transitions.

## Checks

`bun run check` passed TypeScript, all 38 tests, and public-file checks. `git diff --check` passed. React Doctor found no issues in the changed files. The iOS Debug development build compiled and installed successfully.

Temporary runtime fixtures, simulator connection files, and the capture harness are excluded from the application changes. The EAS sessions and the task's Metro tunnel are stopped after verification.
