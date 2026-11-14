# Streaming POIs into the first map load

How the walkshed's points of interest reach the map, what this repository does today to keep the first load responsive while they arrive, and the options for going further. Measured with `perf/latency.mjs` (see `perf/README.md`); the numbers below come from one cloud runner with software GL, so compare them with each other, not with field data.

## Where POIs come from today

- The build writes the full POI set (26k points, all tags and popup details) as a 0.01-degree grid of GeoJSON tiles: `public/cities/<slug>/pois/tiles/{col}_{row}.geojson`, plus `index.json` with a precomputed station-to-tiles lookup (INV-019, INV-020).
- A station needs about 11 tiles. Downtown that is a lot of data: Westlake's 11 tiles are **2.41 MB raw, about 330 KB gzip**, holding 3,951 features. Only 2,604 of them fall inside its 15-minute walkshed; the rest are clipped away after download.
- Each feature carries everything its popup can show: `website`, `phone`, `hours`, `address`, `sources` and a full `stations[]` array with walking distances to every nearby station.
- Each POI on the map is an HTML `<Marker>` (a React `CategoryIcon` roundel), with a Mapbox symbol layer for the name labels only.

## What the first load does now

The station to show is known about half a second into the load (the stations file), long before the map can draw. So:

1. **Walksheds** come from one committed `walksheds.json` per city (20 KB gzip for Seattle, #108), fetched as soon as the stations file arrives.
2. **POI tiles are prefetched behind the `mapbox-gl` chunk.** Started earlier, they shared the connection with that 460 KB chunk and pushed map load back about 0.85 s on a throttled phone (measured live after #108). They now start when the chunk has arrived, at low fetch priority, nearest tile first. On the mobile profile they finish around 6 to 7 s, well before map load at about 10 s.
3. **POIs stream in as tiles land.** Every tile for a station is requested at once, nearest-first to the station. Each tile is point-in-polygon clipped as it arrives, and landed tiles are committed to the map at most once per animation frame. The previous station's POIs stay up until the first new batch replaces them, so a re-clip never flashes empty. On the first load everything is already cached by the time the station is selected; the streaming pays off on the next station, which is not prefetched.
4. **User Timing marks** `walksheds:pois-first` and `walksheds:pois-complete` record when the first and last batch were committed, so the latency suite (and any trace) measures what the user sees instead of inferring it from the network.

## What still costs time while points arrive

| Cost | Size today | Where it hurts |
| --- | --- | --- |
| Bytes | 330 KB gzip for Westlake's tiles; most of it popup-only fields and points outside the walkshed | Slow links: about 1.7 s at 1.6 Mbps, competing with the map's own tiles |
| JSON parse on the main thread | About 7 ms for 2.41 MB on a fast CPU; 30 to 60 ms on a 4x slower phone; the largest tile (686 KB) parses in one go | Short long-tasks while the map is animating |
| Point-in-polygon clip | 3,951 points against the walkshed ring | Small, but repeated on every band toggle |
| One HTML marker per POI | 170 markers for the default coffee and park filters; about 2,600 with "everything" | Every pan and zoom frame repositions every marker in the DOM. This is the biggest risk to responsiveness: streaming more points in makes interaction heavier, not just the load |

## Options, in order

### 1. Slim the render payload (high impact, medium effort)

Split each POI into what the map draws (`id`, `name`, `category`, `tags`, point) and what the popup shows (contact details, hours, walking distances). Measured on Westlake:

- Slim spatial tiles: 330 KB to **161 KB gzip**.
- A slim **per-station bundle**, only the POIs inside that station's walkshed with their band: **97 KB gzip**, one request, and no point-in-polygon pass, because membership is precomputed (the same membership INV-010 already checks).

Popup details are then fetched on demand, per POI or per tile, when a popup opens. This changes the tile contract, so INV-019 and INV-020 are reworked rather than dropped.

### 2. Draw POIs on the GPU (high impact for interaction, medium effort)

Replace the per-POI HTML markers with a Mapbox symbol layer: rasterize the existing `CategoryIcon` roundels into the map's sprite (`map.addImage`, as `stationIcons.js` already does for station pills) and draw them from the same GeoJSON source as the labels. Streaming a batch in becomes one `setData` on that source, processed in Mapbox's worker, instead of React reconciling thousands of DOM nodes. Pan and zoom cost stops growing with the number of points, and symbol collision handles crowded blocks. Clicks move from marker handlers to `interactiveLayerIds`, which the station circles already use.

### 3. Stream bytes, not just tiles (medium impact, small to medium effort; pairs with 1)

Serve each station's slim bundle as newline-delimited GeoJSON, sorted by walking distance, and read it with `ReadableStream` plus `TextDecoder`, committing a batch per frame. The nearest points are in the first few kilobytes of a single response, so the first dots draw after one round-trip plus a sliver of bytes, whatever the bundle's total size. Parsing happens line by line, so no single long task.

### 4. Parse off the main thread (small impact, small effort)

Fetch, parse and clip tiles in a Web Worker and post back only the clipped, slim features. Worth it only if the payload stays large; options 1 and 3 mostly remove the need.

### 5. POIs as vector tiles (the full answer, large effort)

Build the POI set into a vector tileset with tippecanoe and serve it as PMTiles from Pages (HTTP range requests) or as a Mapbox-hosted tileset. Mapbox then fetches, parses and draws POIs per zoom and viewport in its own workers, streaming tile by tile like the basemap. Restricting to the walkshed is a `within` filter on the walkshed polygon. What still needs JavaScript-side data (filter pill counts, search, popup details) comes from a small per-station summary and on-demand detail fetches. Costs: tippecanoe in the build, a new tileset invariant suite replacing INV-019 and INV-020, and a PMTiles protocol handler on the client.

## Recommendation

Do 2 and 1 next, in that order. The GPU layer removes the cost that grows as points stream in, and the slim per-station bundle cuts the bytes by about two thirds. Add 3 on top of the per-station bundle once it exists; it is a small change at that point. Hold 5 until the dataset or the city count outgrows per-station bundles; it is the right end state for a much larger POI set, but a large change for today's 26k points.
