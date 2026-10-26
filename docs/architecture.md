# Client architecture

Browse tabs use a saved league preference. Detail links include the league in their URL. An entity id alone cannot identify a basketball team or player across leagues, and a preference change must not rewrite earlier navigation history.

The API boundary parses JSON into named types. Screens do not inspect arbitrary JSON. Display strings such as records, scores, and clock labels remain as the API returns them. The API's CSS hero value is not a native style. Native backdrops use team accent colors instead.

React Query owns server responses. Query keys include league, resource parameters, and time zone when relevant. The selected date is a calendar date. It never becomes a UTC timestamp just to move one day forward.

Live polling follows the API hint while the relevant screen is focused and the app is active. A failed refresh keeps the last successful response visible. Changing a date or league must not label the previous response as new data.

Expo Router owns tabs, stacks, headers, back gestures, and sheets. Entity routes carry enough information to reopen from a deep link. Route files contain route concerns; screen bodies and shared UI live outside `src/app`.

Expo UI owns native controls where the installed SDK provides them. On SDK 58, native tabs use `expo-router/native-tabs`. The universal Picker supports menu and wheel appearances. Segmented controls and date pickers use the package's native community replacements. Unknown-length data uses virtualized React Native lists.

The design stays dark with restrained orange highlights. Repeated colors, spacing, type styles, radii, and motion values belong in one theme. Team colors remain API data. Native transitions provide navigation motion, and frequent actions receive only brief feedback.

Notification delivery is optional. No notification backend URL is built in. A configured service must accept this app's own identifier and native token type. Installation credentials stay in SecureStore. They never enter the sports query cache, diagnostics, or documentation.

The architecture comparison considered a global-only league store and league-prefixed URLs for every browse route. The hybrid design keeps browse roots simple while preserving detail identity. Standard native day paging replaces a custom pager state machine. An independent review agreed with both choices and corrected control imports against the installed SDK.
