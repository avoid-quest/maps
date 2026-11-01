# Transitous fixtures

Public responses recorded on 2026-11-01 (about 19:20–19:30 UTC) from `https://api.transitous.org` with the app's identifying User-Agent. Each file came from one bounded request; no polling. The responses contain public timetable data only.

| File | Request |
|---|---|
| `stoptimes-porta-susa.json` | `GET /api/v6/stoptimes?stopId=it-trenitalia_00222&n=12` |
| `stoptimes-porta-susa-arrivals.json` | `GET /api/v6/stoptimes?stopId=it-trenitalia_00222&n=12&arriveBy=true&direction=LATER`, recorded 20:10 UTC |
| `stoptimes-lingotto.json` | `GET /api/v6/stoptimes?stopId=it-trenitalia_00452&n=20`, trimmed to the first 8 stop times |
| `stoptimes-porta-nuova.json` | `GET /api/v6/stoptimes?stopId=it-trenitalia_00219&n=20`, trimmed to the first 5 stop times |
| `stoptimes-gtt-2198.json` | `GET /api/v6/stoptimes?stopId=it-Piemonte-Gruppo-Torinese-Trasporti_2198&n=8&radius=0&exactRadius=true` |
| `trip-sfm-26481.json` | `GET /api/v6/trip?tripId=20261101_19%3A07_it-trenitalia_0083_720083_0_v_72-26481-34C1-0083_v_72-26481-34C1-0083&detailedLegs=false` |
| `geocode-lingotto.json` | `GET /api/v1/geocode?text=Lingotto&type=STOP&numResults=5&min=44.9,7.4&max=45.3,7.95` |
| `map-stops-porta-susa.json` | `GET /api/v6/map/stops?min=45.0727,7.6652&max=45.0755,7.6693` |
| `error-unknown-stop.json` | HTTP 404 body for an unknown `stopId` without `center` |

No cancellation occurred during the probes. Tests derive cancelled and malformed cases by modifying copies of recorded rows; the files themselves are unmodified apart from trimming and JSON indentation.
