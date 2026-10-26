# API details that affect the client

The API audit covered all nine sports routes with read-only requests. The responses mostly contain display-ready strings, but several fields need care in a native client.

Entity ids belong to a league. A route for a team, player, or game carries both its id and league so a later preference change cannot reinterpret an older link.

Game start times can omit seconds. The client accepts the service's time string instead of requiring a stricter timestamp format. Final game detail can report period zero. The latest available period chip determines the initial play filter for a completed game.

WNBA conferences can be named E and W, and college basketball has many conferences. Standings controls come from the response rather than hardcoded East and West comparisons. College teams may have no group list, so the client falls back to one virtualized team list.

The hero value is a CSS gradient intended for a web view. The native app builds its backdrop from team colors. The flow chart is different: its SVG paths are reusable in a native SVG view with the API's coordinate system.

The service can return upstream diagnostics in an error's detail field. That field does not belong in user-facing copy. The client needs a readable failure message and a retry action.

No game was live during the initial audit. Live polling and response models are based on the service code and existing sample structure until a live game can be observed. This distinction remains in the verification record.
