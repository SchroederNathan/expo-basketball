# Basketball API

The default base URL is `https://lob-api.expo.app/api`. `EXPO_PUBLIC_API_URL` can replace it at bundle time. The client does not deploy or modify the service.

All sports routes accept `league`. Supported values are `nba`, `wnba`, `mens-college-basketball`, and `womens-college-basketball`. Date-sensitive routes accept `tz`, an IANA time zone such as `America/Toronto`.

| Request | Response |
| --- | --- |
| `GET /scoreboard?date=YYYYMMDD` | Selected day, nearby calendar days, games, and live status |
| `GET /games/:id` | Game, linescore, flow paths, leaders, box score, relevant standings, and venue information |
| `GET /games/:id/plays?period=` | Play-by-play and available period filters |
| `GET /standings` | Season, conferences, and divisions |
| `GET /teams` | Teams and division groupings |
| `GET /teams/:id` | Team, roster, recent results, and upcoming schedule |
| `GET /players?stat=points` | Season leaders and available stat categories |
| `GET /players/:id` | Player biography, averages, ranks, and recent games |
| `GET /search?q=` | Matching teams and players |

The leaders endpoint supports `points`, `rebounds`, `assists`, `steals`, `blocks`, and `threes`. An omitted scoreboard date means today in the requested time zone.

API responses contain presentation strings, including scores, percentages, records, and clock labels. The client preserves these strings. It validates response structure before rendering and does not treat missing data as a score of zero.

Team logos and player headshots are third-party images. Missing images must leave a stable layout and a readable text label. Public availability of data or an image URL does not grant ownership of league marks.
