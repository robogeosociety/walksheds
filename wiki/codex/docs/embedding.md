# Embedding Walksheds

Walksheds can be embedded in another site or dashboard as an **iframe** served
from `walksheds.xyz`. Framing the live site (rather than shipping a JS bundle)
keeps the origin-restricted Mapbox token valid and isolates the app's CSS and
global state from the host page.

There are two ways in: a copy-paste **helper script** (recommended) or a plain
**iframe** with query parameters. A live demo + snippet generator is served at
<https://walksheds.xyz/embed.html>.

## Quick start (helper script)

```html
<div id="walksheds" style="max-width:720px"></div>
<script src="https://walksheds.xyz/embed.js"></script>
<script>
  const w = Walksheds.embed('#walksheds', {
    station: 'seattle/1/50',      // or { line: '1', stopCode: 50 }
    walkshed: [5, 10],            // enabled bands (minutes)
    pois: 'coffee,park',          // POI filters
    dark: false, units: 'metric',
    chrome: { legend: true, search: true },
    origin: location.origin,      // pin the postMessage peer (recommended)
    onReady: () => {},
    onStationChange: (s) => console.log(s.name),
  })

  // Drive it later:
  w.select('2', 58)               // Bellevue Downtown
  w.setWalksheds([5, 10, 15])
  w.setFilters('coffee,bar')
  w.setDark(true)
  w.setUnits('imperial')
</script>
```

`embed.js` builds the iframe, injects a responsive aspect-ratio box (pass
`height` for a fixed height instead), and wires the two-way `postMessage`
bridge to your callbacks and the returned control handle.

## Plain iframe

```html
<iframe
  src="https://walksheds.xyz/seattle/1/50?embed=1&walkshed=5&walkshed=10&pois=coffee,park"
  style="width:100%;aspect-ratio:4/3;border:0"
  allow="geolocation; gyroscope; magnetometer"
  loading="lazy"
  title="Walksheds"></iframe>
```

## Embed mode

`?embed=1` switches the app into embed mode, which:

- **strips onboarding + branding chrome** by default (see the flag table);
- **stops writing to the URL and to `localStorage`** — the iframe `src` stays
  the source of truth, and (because the frame shares `walksheds.xyz` storage
  with the real site) an embed never flips a visitor's saved preferences;
- **opens the `postMessage` bridge** for host control.

Initial state still hydrates from the URL you set: the deep-link path
`/seattle/{line}/{stopCode}`, `?walkshed=`, and `?pois=`.

## URL parameters

| Param | Values | Meaning |
|---|---|---|
| `embed` | `1` | Master switch — enables embed mode. |
| `legend`, `search` | `0`/`1` | Show the legend / POI search (default on). |
| `help`, `guide` | `0`/`1` | Legend help button / wiki link (default off in embed). |
| `report`, `locate` | `0`/`1` | POI report link (default off) / map locate control (default on). |
| `hints` | `0`/`1` | Onboarding overlay (default off in embed). |
| `darktoggle`, `unitstoggle` | `0`/`1` | Show the dark / units toggles in the legend (default on). |
| `dark` | `0`/`1` | Force light / dark. Omit for the default (light). |
| `units` | `metric`/`imperial` | Distance units. |
| `walkshed` | `5`/`10`/`15` (repeatable) | Which walkshed bands start enabled. |
| `pois` | e.g. `coffee,park` | Initial POI filters. |
| `origin` | e.g. `https://host.example` | Pin the postMessage peer origin. |
| path | `/seattle/{line}/{stopCode}` | Initial station, e.g. `/seattle/1/50` (Westlake). |

## postMessage protocol

Outbound messages (iframe → host) carry `{ source: 'walksheds', type, payload }`;
inbound commands (host → iframe) must carry `{ source: 'walksheds-host', type,
payload }`.

| Direction | Message | Payload |
|---|---|---|
| iframe → host | `ready` | `{}` — once the map has loaded |
| iframe → host | `stationchange` | `{ name, line, stopCode, lines, lng, lat }` |
| host → iframe | `selectStation` | `{ line, stopCode }` |
| host → iframe | `setWalksheds` | `{ minutes: [5,10,15] }` |
| host → iframe | `setFilters` | `{ pois: "coffee,park" }` |
| host → iframe | `setDark` | `{ dark: true }` |
| host → iframe | `setUnits` | `{ units: "imperial" }` |

### Security

Inbound commands are accepted only when tagged with the `walksheds-host`
source and — if you set `origin` — from that exact origin. Every command only
mutates map/filter state; none touch storage, navigation, or the host window,
so the surface is a whitelist by construction. Outbound payloads carry only
public map data, so the default outbound target origin is `*`; pin it with
`origin` when embedding on a known host.

## Implementation

- `src/embedConfig.js` — parses `?embed` + flags into a frozen config.
- `src/embedBridge.js` — the `useEmbedBridge` hook (outbound events + inbound
  command whitelist).
- `src/Walksheds.jsx` — threads the config: init overrides, skipped URL/storage
  writes, chrome gating.
- `public/embed.js` — framework-free host helper.
- `public/embed.html` — live demo + snippet generator.
