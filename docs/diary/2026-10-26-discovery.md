# Building a native basketball client

The app reads an existing basketball API at `https://lob-api.expo.app/api`. The client needs no API key. Images come from ESPN's CDN.

The API supports NBA, WNBA, men's college basketball, and women's college basketball. It returns normalized scoreboards, game details, play-by-play, standings, teams, rosters, player leaders, player profiles, and search results.

Scoreboards use compact calendar dates such as `20261026`. Requests include the viewer's IANA time zone. A date is a calendar day, not a timestamp. Date arithmetic must avoid daylight-saving shifts.

Live games need a 15-second refresh. A screen must retain its last successful response if a refresh fails. Query keys include the league, time zone, and resource parameters to keep cached responses separate.

The new repository starts with Expo SDK 58. Routes live in `src/app`, screen bodies live in `src/screens`, and repeated visual values belong in one theme. Native tabs and stack headers own navigation. Expo UI supplies native controls. Long lists use React Native virtualization.

Motion serves feedback and navigation. Tab changes use the platform default. Custom press feedback, if needed, stays brief and respects reduced motion. No decorative entrance animation delays score reading.

Push delivery is a separate integration from sports data. A new application identifier needs a push service configured for that identifier. Sports browsing must work without push configuration or credentials.
