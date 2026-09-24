"""Per-city ingest modules.

Each module exposes `build(city)` returning
`(stations_geojson, {line id: alignment FeatureCollection})`; data/process.py
handles everything downstream (writing, the station index, sprites).
"""
