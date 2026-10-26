# Native verification

The iOS development build exposed layout problems that TypeScript and bundle exports could not catch. Router clones the child of a link. A Pressable style callback did not survive that composition, so linked score rows stacked their contents vertically. The shared RowLink now resolves its style to an object before Router clones it. Game heroes, leaders, and box-score player links use the same component.

The unsigned simulator also reported a keychain error when the native notifications module loaded. Push support now gates the native response bridge, and permission and token functions import notifications only when called. Browsing sports data does not load push observers in an unsupported build.

The independent review found four additional issues. An HTTP 200 response containing a blank team now becomes a missing-team error. Offline refreshes stop displaying a pending spinner and retain cached content with a connection notice. A failed push registration can return to registration when the service reports an unknown installation. Cached plays now show refresh errors. Request refreshes use the fetch cache policy instead of an undocumented timestamp parameter.

React Compiler rejected a loop without a test in the preference conflict handler. The handler now performs one explicit retry after merging edits into the latest revision. React Doctor reports no compiler errors. Its four remaining warnings and their triage are in the [review record](../verification/review.md).

Native checks covered the day strip, calendar selection outside the paging window, horizontal day swipes, completed and upcoming games, play-period filters, team schedules, tab history, WNBA conference filters, college standings, stat leaders, player profiles, and search. Searching for curry returned Stephen Curry and opened his profile. An unmatched query showed the empty state. The [verification record](../verification.md) distinguishes these checks from push delivery, Android interaction, and release performance.

The development client's floating tools button covered trailing header actions. The app hides it in native development builds through the supported dev-client API. Metro still opens the developer menu. This change keeps the notification control and modal dismissal reachable while testing.

The public repository contains the separate app, neutral architecture notes, and verification records. Provider credentials, installation credentials, and machine paths stay outside it. The sports API remains unchanged.
