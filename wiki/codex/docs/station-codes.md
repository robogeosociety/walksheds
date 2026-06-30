# Station codes

Sound Transit uses three-digit station codes. The first digit is the line number; the last two are the **stop code**. Westlake — the center of the system — is 50. Numbers increase going south and east, and decrease going north. Gaps are reserved for future infill stations.

Walksheds keys stations by `{lines}-{stopCode}` so the two stations that share stop code 54 (Stadium on Line 1, Judkins Park on Line 2) stay distinct.

!!! quote "References"
    [Sound Transit stations](https://www.soundtransit.org/ride-with-us/stations/link-light-rail-stations) ·
    [Understanding the three-digit codes](https://www.soundtransit.org/blog/platform/understanding-sound-transits-new-three-digit-station-codes). Local screenshots live in `data/reference/`.

## Shared stations — both lines

These run from Lynnwood down to International District and carry both <span class="roundel roundel-1">1</span> and <span class="roundel roundel-2">2</span>.

| Stop | Station |
| --- | --- |
| 40 | Lynnwood City Center |
| 41 | Mountlake Terrace |
| 42 | Shoreline North / 185th |
| 43 | Shoreline South / 148th |
| 44 | NE 130th St *(future)* |
| 45 | Northgate |
| 46 | Roosevelt |
| 47 | U District |
| 48 | UW |
| 49 | Capitol Hill |
| 50 | Westlake |
| 51 | Symphony |
| 52 | Pioneer Square |
| 53 | Intl District / Chinatown |

## Line 1 only — south

<span class="roundel roundel-1">1</span> continues south from International District to Federal Way.

| Stop | Station |
| --- | --- |
| 54 | Stadium |
| 55 | SODO |
| 56 | Beacon Hill |
| 57 | Mount Baker |
| 58 | Columbia City |
| 59 | Graham St *(future)* |
| 60 | Othello |
| 61 | Rainier Beach |
| 62 | Boeing Access Rd *(future)* |
| 63 | Tukwila Intl Blvd |
| 64 | SeaTac / Airport |
| 65 | Angle Lake |
| 66 | Kent Des Moines |
| 67 | Star Lake |
| 68 | Federal Way Downtown |

## Line 2 only — east

<span class="roundel roundel-2">2</span> branches east across Lake Washington to Redmond.

| Stop | Station |
| --- | --- |
| 54 | Judkins Park |
| 55 | Mercer Island |
| 56 | South Bellevue |
| 57 | East Main |
| 58 | Bellevue Downtown |
| 59 | Wilburton |
| 60 | Spring District |
| 61 | BelRed |
| 62 | Overlake Village |
| 63 | Redmond Technology |
| 64 | Marymoor Village |
| 65 | Downtown Redmond |

!!! note "38 live stations"
    The app ships exactly 38 stations ([INV-012](invariants.md)). The *(future)* rows above are reserved codes, not yet in `all-stations.geojson`.
