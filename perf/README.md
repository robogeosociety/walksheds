# Latency suite

`perf/latency.mjs` measures how long Walksheds takes to become useful, from navigation start to the walkshed POIs on screen. It loads the app in headless Chromium, cold (fresh browser context) and warm (reload with the HTTP cache primed), under a desktop and a mobile profile, and reports the median and p90 of each load-chain milestone over N runs.

```bash
npm run latency                                   # live site, desktop + mobile, cold + warm, 5 runs
npm run latency -- --path /seattle/1/50           # a station deep link
npm run latency -- --dist dist --runs 3           # a local build, served as walksheds.xyz
npm run latency -- --profiles desktop --no-warm --out results.json
```

Set `CHROMIUM_PATH` when Playwright's pinned browser build is not installed (on Claude Code cloud runners: `CHROMIUM_PATH=/opt/pw-browsers/chromium`).

## Milestones

Times are ms from navigation start. The app has no timing hooks, so the map milestones are read from the network.

| Milestone | Meaning |
| --- | --- |
| `ttfb`, `fcp`, `lcp`, `dcl` | Browser navigation and paint timings |
| `appJs` | Last app JS chunk received (entry chunk plus the lazily imported `mapbox-gl` chunk) |
| `canvas` | Map canvas inserted into the DOM |
| `mapStyle` | Mapbox Standard style (and iconset) received |
| `mapLoad` | Map `load` event. Proxy: the station sprite request, which `MapView` fires from its load effect |
| `isochroneStart` / `isochroneEnd` | First and last Mapbox Isochrone request: a station was selected / its walkshed polygons can render |
| `walkshedData` | Walkshed polygons received, from the Isochrone API or the city's committed `walksheds.json` (whichever the build uses) |
| `poiTilesEnd` | Last POI tile received: the walkshed's POIs can render |
| `selected` | The selected station's name pill appears: a station was selected |
| `poisVisible` | `max(selected, walkshedData, poiTilesEnd)`: the walkshed's POI dots can draw. The headline number |
| `poisFirst` / `poisComplete` | App User Timing marks (`walksheds:pois-first`, `walksheds:pois-complete`): the first batch of the walkshed's POIs committed for drawing, and the last. Read directly from the page, so they need no network proxy; absent (`-`) on builds before they were added |
| `settled` | Last response before a quiet window (map tiles for the framed walkshed included): visually complete |

`TBT` is total blocking time (the sum of long-task time over 50 ms) up to `settled`. Bytes are encoded (on-the-wire) sizes, broken down by request kind.

## Profiles

| Profile | Viewport | Network | CPU |
| --- | --- | --- | --- |
| `desktop` | 1440x900 @1x | unthrottled | 1x |
| `mobile` | 390x844 @3x, touch | 150 ms RTT, 1.6 Mbps down, 750 Kbps up (Lighthouse "Slow 4G") | 4x slowdown |

## Comparing builds (`--dist`)

The Mapbox token is restricted to `walksheds.xyz`, so a local `vite preview` cannot load the map. `--dist <dir>` serves a build *as* `https://walksheds.xyz` by intercepting requests, so the token in that build works. This is how to hunt regressions (build an old commit, measure it) and to check a fix before it ships:

```bash
VITE_MAPBOX_ACCESS_TOKEN=pk.... npx vite build --outDir /tmp/dist-candidate
npm run latency -- --dist /tmp/dist-candidate --no-warm
```

Caveats in this mode:

- Same-origin assets are served from disk without network throttling or CDN latency, and are counted at their gzip size (what Pages ships). Mapbox requests still go over the real network.
- So `--dist` numbers are comparable with each other, not with live numbers. Use the live site for absolute mobile timings.

## Caveats

- Headless runners have no GPU. Map rendering runs on SwiftShader (software GL), which inflates TBT and the map's render milestones. Every target pays the same cost, so comparisons hold, but real devices render faster.
- A cloud runner's egress latency (and any proxy) is in every network number. Compare runs taken from the same machine, not against field data.
- Builds before #109 held a plain `/` visit on the system overview for a deliberate 900 ms before selecting the default station; deep links (`/seattle/1/50`) never had that delay. Keep it in mind when comparing `/` against older builds.
