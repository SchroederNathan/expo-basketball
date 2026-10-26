# Expo client implementation plan

The completed client must load real data from the basketball API and support all four leagues. Users can browse dates, open a game, read its box score and plays, inspect standings, browse teams and players, and search. Every request has initial loading, failure, empty, and content states. Refresh failures retain cached content.

## Sequence

1. Inspect the API and compare two native client structures.
2. Establish the Expo app, typed request boundary, calendar helpers, and query ownership.
3. Build native navigation, theme, reusable score and table views, and all sports screens.
4. Add notification integration without coupling sports browsing to push setup.
5. Run API contract checks and focused tests, export all platforms, and exercise the app in a simulator.
6. Review the implementation and decision trail. Record remaining device or service requirements.

## Throughput checkpoint

- Blocking first steps. Read the API contract and resolve the route and state structure before screen implementation.
- Independent workstreams. Architecture candidates produce separate temporary documents. Implementation has one owner. Documentation and verification can proceed separately.
- Shared mutable state. The implementation owner controls source files. The coordinator controls dependencies, public documentation, and device sessions. Dependency changes finish before implementation starts.
- Smallest safe decomposition. One owner implements the coupled client so schemas, query hooks, routes, and screens agree. Independent reviewers check the result after implementation.

## Verification standard

Type checking and bundle exports prove compatibility, but do not prove a usable interface. Real API requests prove contract assumptions. Simulator interaction proves navigation and screen behavior. Release-device motion, physical push delivery, and Android behavior require their own evidence before they can be called verified.
