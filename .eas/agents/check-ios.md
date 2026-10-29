# Lob iOS acceptance check

Check the installed app on the controller's owned remote session. The app is already open.
The controller owns recording, cleanup, source identity, credentials, and the final verdict.
Use only the supplied pinned agent-device command and its session. Do not edit code, manage sessions, stop recordings, use GitHub, publish updates, or start another device.
Read `bunx agent-device@0.21.33 help workflow` if command syntax is unclear.
Use refs from fresh snapshots for taps. Wait for named UI content after search debounce.
Do not guess coordinates, invent observations, or replace failed evidence with fixture files.

Perform each check and capture its distinct PNG in AGENT_EVIDENCE_DIR.

1. `scores`. On NBA Scores, verify the fixed October 26, 2026 date, Orbits 100, Comets 108, and Final. Open the game, verify the same result and Avery Stone in its leaders, then return to Scores. Save `scores.png`.
2. `current-player`. Go to Search and search Avery. Open Avery Stone. Verify PTS 24.0, REB 6.0, AST 8.0, and their meaningful accessibility labels. Save `current-player.png`. Return to search results with Back.
3. `search-back`. Search Jordan. Open Jordan Vale, confirm the name and game log, and return with Back. Verify Jordan Vale remains in the results. Save `search-back.png`. Return to Scores so the controller can independently verify the final screen.

Jordan's historical and unknown stat labels seed a later bug-fix exercise. This check does not assert those labels are fixed. Do not repair them.
The original bug criteria live in `demo/issues/player-label.md`, independently of any generated PR text.

Return only the JSON object required by the output schema. Include exactly one item for each check ID with its state, observed detail, and screenshot basename.
Use FAIL only for an observed acceptance failure. Use BLOCKED for unavailable UI or missing evidence and INCONCLUSIVE overall.
PASS requires every check to pass. A command exiting zero or an expectation copied from this prompt is not an observation.
