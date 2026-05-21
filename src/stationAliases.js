// Shorthand → canonical station name for the search box. Keys are in the
// normalized form produced by normalizeQuery() in POISearch.jsx (lowercased,
// accent-stripped, spaces/underscores collapsed to hyphens). The matcher
// surfaces the alias key in the dropdown label when an alias is what matched,
// mirroring the POI TAG_ALIASES flow.
export const STATION_ALIASES = {
  'cap-hill': 'Capitol Hill Station',
  'capitol-hill': 'Capitol Hill Station',

  'u-dub': 'UW Station',
  'udub': 'UW Station',
  'husky-stadium': 'UW Station',

  'u-district': 'U District Station',
  'udistrict': 'U District Station',

  'chinatown': 'Intl District/Chinatown Station',
  'intl-district': 'Intl District/Chinatown Station',
  'international-district': 'Intl District/Chinatown Station',
  'id': 'Intl District/Chinatown Station',
  'idc': 'Intl District/Chinatown Station',

  'seatac': 'SeaTac/Airport Station',
  'sea-tac': 'SeaTac/Airport Station',
  'airport': 'SeaTac/Airport Station',

  'downtown-bellevue': 'Bellevue Downtown Station',
  'bellevue': 'Bellevue Downtown Station',

  'sodo': 'SODO Station',
  'stadium': 'Stadium Station',

  'pioneer-square': 'Pioneer Square Station',
  'pio-sq': 'Pioneer Square Station',

  'northgate': 'Northgate Station',
  'roosevelt': 'Roosevelt Station',

  'mount-baker': 'Mount Baker Station',
  'mt-baker': 'Mount Baker Station',

  'columbia-city': 'Columbia City Station',
  'beacon-hill': 'Beacon Hill Station',
  'rainier-beach': 'Rainier Beach Station',
  'othello': 'Othello Station',

  'tukwila': 'Tukwila Intl Blvd Station',

  'angle-lake': 'Angle Lake Station',
  'kent-des-moines': 'Kent Des Moines Station',
  'star-lake': 'Star Lake Station',
  'federal-way': 'Federal Way Downtown Station',

  'mercer-island': 'Mercer Island Station',
  'south-bellevue': 'South Bellevue Station',
  'east-main': 'East Main Station',
  'wilburton': 'Wilburton Station',
  'spring-district': 'Spring District Station',
  'belred': 'BelRed Station',
  'bel-red': 'BelRed Station',
  'overlake': 'Overlake Village Station',
  'redmond-tech': 'Redmond Technology Station',
  'microsoft': 'Redmond Technology Station',
  'marymoor': 'Marymoor Village Station',
  'downtown-redmond': 'Downtown Redmond Station',
  'redmond': 'Downtown Redmond Station',

  'judkins-park': 'Judkins Park Station',
  'lynnwood': 'Lynnwood City Center Station',
  'mountlake-terrace': 'Mountlake Terrace Station',
  'shoreline-north': 'Shoreline North/185th Station',
  'shoreline-south': 'Shoreline South/148th Station',

  'westlake': 'Westlake Station',
  'symphony': 'Symphony Station',
}
