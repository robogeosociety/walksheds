# Glossary

Terms used across the app and this codex.

Walkshed
:   The area reachable on foot from a station within a given time. Walksheds draws three per station — 5, 10, and 15 minutes.

Isochrone
:   A line of equal travel time. The walkshed bands are isochrone polygons from the Mapbox Isochrone API. See [Walksheds](data/walksheds.md).

Band
:   One of the three walkshed rings, identified by its minute value: `5`, `10`, or `15`. A POI's nearest-station entry records which band it falls in.

Roundel
:   The filled circle carrying a line number — <span class="roundel roundel-1">1</span> or <span class="roundel roundel-2">2</span>. The base unit of the station vocabulary.

Pill
:   A station label combining one or two roundels, the two-digit stop code, and the name. Built as SVG in `src/stationIcons.js`. See [Design system](design-system.md).

Stop code
:   The last two digits of a Sound Transit station code. Westlake is 50; numbers rise south and east. Two stations share code 54. See [Station codes](station-codes.md).

Station key
:   `{lines}-{stopCode}`, e.g. `1,2-50` or `1-54`. Disambiguates the two stations sharing stop code 54 and keys the walkshed, distance, and exit dumps.

POI
:   Point of interest — a restaurant, cafe, bar, shop, museum, park, and so on. Sourced from OpenStreetMap and Overture. See [POIs](data/pois.md).

Tile
:   One cell of the spatial grid the POI dataset is partitioned into: `public/pois/tiles/{col}_{row}.geojson`. The runtime loads only the tiles overlapping a selected station's walkshed. See [Refined POIs](data/refined-pois.md).

`station_tiles`
:   A precomputed map in `index.json` from a station key to the tile keys it needs — lets the runtime skip bbox math. Guarded by [INV-020](invariants.md).

Conflation
:   Merging OSM and Overture records for the same place into one POI — best-of-both: Overture contact data, OSM hours and qualifier tags. Done in `build_refined.py`.

Best exit
:   The station exit physically closest (straight-line / haversine) to an open POI popup, highlighted orange. Computed live in the browser by `nearestExit`. See [Station exits](data/station-exits.md).

Invariant
:   A numbered, append-only data or design contract (`INV-NNN`), most enforced by tests. See [Core invariants](invariants.md).

Refresh
:   The `--refresh` path on a build script that re-pulls from the network (Overpass, Mapbox, Overture) and rewrites the committed raw dump. The default path rebuilds offline from that dump.

Matrix
:   The Mapbox Matrix API, used to compute walking distance and duration for every (station, POI) pair inside a 15-minute walkshed. See [Walksheds](data/walksheds.md).
