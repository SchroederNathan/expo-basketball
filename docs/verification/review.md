# Review record

An independent Claude Opus 5.5 review examined the client, comments, and decision trail before the final simulator checks. The coordinator assessed the findings and applied the fixes.

## Accepted findings

- A blank team returned with HTTP 200 rendered as a real team. The fetch boundary now rejects that response, and a behavior test covers it. A cold native link to an unknown team showed the missing-team screen.
- A paused offline refresh could leave its spinner active. The query adapter now observes connectivity, retains cached data, and displays a connection notice. A behavior test covers cached offline content.
- An installation credential left after a failed registration could block another attempt. Service 401 and 404 responses now return the notification center to registration. End-to-end service recovery still needs a configured service and signed device.
- The plays feed omitted errors during a failed refresh. Ready cached plays now include the shared refresh error control.
- A comment claimed timestamp URL parameters defeated stale responses without evidence. Manual refresh now uses the fetch cache policy, with a request test. The unsupported claim and parameter were removed.
- Early decision-trail entries proved setup or reachability, rather than finished behavior. Later entries and the verification record identify typed API checks, bundle checks, and native interaction separately.

## Runtime findings

Simulator checks found linked row styles lost during child cloning, early native notification imports, and a development tools overlay covering header controls. The diary records the fixes. These findings came from coordinator testing after the independent review.

## React Doctor triage

The final scan reports no errors and four warnings across 93 files.

| Warning | Assessment |
| --- | --- |
| Non-component export in league-picker.tsx | The exported header options function is used by native screen configuration. This may limit Fast Refresh behavior; it does not change routing or league selection. |
| High complexity in the game screen | The screen coordinates loading, three content tabs, and sharing. Kept together after reviewing its branches. No runtime defect was established by this warning. |
| High complexity in notification settings | The screen renders explicit support and registration states. No split was added solely to satisfy the complexity threshold. Device and service verification remains required. |
| Mapped list in a ScrollView in plays.tsx | This is the small period-filter row, including overtime periods. The play feed itself uses FlatList. Virtualizing the filter row would add complexity without reducing the feed cost. |

No lint suppression was added.
