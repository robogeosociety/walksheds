import MAIN_CATEGORY_IDS from './mainCategories.json'

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

export const SEATTLE_CENTER = [-122.33, 47.60]
export const SEATTLE_ZOOM = 11.5

export const WALKSHED_OPTIONS = [5, 10, 15]
export const WALKSHED_RENDER_ORDER = [15, 10, 5]

export const WALKSHED_STYLES = {
  light: {
    15: { opacity: 0.10, outlineOpacity: 1.0, lineWidth: 2 },
    10: { opacity: 0.15, outlineOpacity: 1.0, lineWidth: 2.5 },
    5:  { opacity: 0.22, outlineOpacity: 1.0, lineWidth: 3 },
  },
  dark: {
    15: { opacity: 0.10, outlineOpacity: 1.0, lineWidth: 2 },
    10: { opacity: 0.15, outlineOpacity: 1.0, lineWidth: 2.5 },
    5:  { opacity: 0.22, outlineOpacity: 1.0, lineWidth: 3 },
  },
}

export const LINE_COLORS = {
  '1-line': { color: '#4CAF50', label: '1 Line' },
  '2-line': { color: '#0082C8', label: '2 Line' },
}

export const WALKSHED_ACCENT_LIGHT = '#0082C8'
export const WALKSHED_ACCENT_DARK = '#4CAF50'

export const POI_CATEGORIES = {
  restaurant:      { color: '#E67E22', group: 'dining', label: 'Restaurant' },
  cafe:            { color: '#E67E22', group: 'dining', label: 'Cafe' },
  bar:             { color: '#E67E22', group: 'dining', label: 'Bar' },
  fast_food:       { color: '#E67E22', group: 'dining', label: 'Fast Food' },
  pub:             { color: '#E67E22', group: 'dining', label: 'Pub' },
  bakery:          { color: '#E67E22', group: 'dining', label: 'Bakery' },
  ice_cream:       { color: '#E67E22', group: 'dining', label: 'Ice Cream' },
  museum:          { color: '#8E44AD', group: 'attractions', label: 'Museum' },
  gallery:         { color: '#8E44AD', group: 'attractions', label: 'Gallery' },
  attraction:      { color: '#8E44AD', group: 'attractions', label: 'Attraction' },
  artwork:         { color: '#8E44AD', group: 'attractions', label: 'Artwork' },
  viewpoint:       { color: '#8E44AD', group: 'attractions', label: 'Viewpoint' },
  park:            { color: '#27AE60', group: 'parks', label: 'Park' },
  playground:      { color: '#27AE60', group: 'parks', label: 'Playground' },
  garden:          { color: '#27AE60', group: 'parks', label: 'Garden' },
  hotel:           { color: '#2980B9', group: 'lodging', label: 'Hotel' },
  hostel:          { color: '#2980B9', group: 'lodging', label: 'Hostel' },
  motel:           { color: '#2980B9', group: 'lodging', label: 'Motel' },
  guest_house:     { color: '#2980B9', group: 'lodging', label: 'Guest House' },
  supermarket:     { color: '#16A085', group: 'shops', label: 'Supermarket' },
  convenience:     { color: '#16A085', group: 'shops', label: 'Convenience Store' },
  cannabis:        { color: '#16A085', group: 'shops', label: 'Dispensary' },
  alcohol:         { color: '#16A085', group: 'shops', label: 'Liquor Store' },
  tobacco:         { color: '#16A085', group: 'shops', label: 'Tobacco Shop' },
  wine:            { color: '#16A085', group: 'shops', label: 'Wine Shop' },
  deli:            { color: '#16A085', group: 'shops', label: 'Deli' },
  department_store:{ color: '#16A085', group: 'shops', label: 'Department Store' },
  variety_store:   { color: '#16A085', group: 'shops', label: 'Variety Store' },
  books:           { color: '#16A085', group: 'shops', label: 'Bookstore' },
  gift:            { color: '#16A085', group: 'shops', label: 'Gift Shop' },
  clothes:         { color: '#16A085', group: 'shops', label: 'Clothing' },
  shoes:           { color: '#16A085', group: 'shops', label: 'Shoes' },
  hardware:        { color: '#16A085', group: 'shops', label: 'Hardware' },
  electronics:     { color: '#16A085', group: 'shops', label: 'Electronics' },
  florist:         { color: '#16A085', group: 'shops', label: 'Florist' },
  jewelry:         { color: '#16A085', group: 'shops', label: 'Jewelry' },
  sports:          { color: '#16A085', group: 'shops', label: 'Sporting Goods' },
  toys:            { color: '#16A085', group: 'shops', label: 'Toy Store' },
  music:           { color: '#16A085', group: 'shops', label: 'Music Store' },
  art:             { color: '#16A085', group: 'shops', label: 'Art Supply' },
  pet:             { color: '#16A085', group: 'shops', label: 'Pet Store' },
  mobile_phone:    { color: '#16A085', group: 'shops', label: 'Mobile Phone' },
  cosmetics:       { color: '#16A085', group: 'shops', label: 'Cosmetics' },
  furniture:       { color: '#16A085', group: 'shops', label: 'Furniture' },
  doityourself:    { color: '#16A085', group: 'shops', label: 'Hardware/DIY' },
  outdoor:         { color: '#16A085', group: 'shops', label: 'Outdoor' },
  bicycle:         { color: '#16A085', group: 'shops', label: 'Bicycle Shop' },
  pharmacy:        { color: '#E74C3C', group: 'healthcare', label: 'Pharmacy' },
  hospital:        { color: '#E74C3C', group: 'healthcare', label: 'Hospital' },
  clinic:          { color: '#E74C3C', group: 'healthcare', label: 'Clinic' },
  library:         { color: '#F1C40F', group: 'services', label: 'Library' },
  bank:            { color: '#F1C40F', group: 'services', label: 'Bank' },
  post_office:     { color: '#F1C40F', group: 'services', label: 'Post Office' },
  fitness_centre:  { color: '#E91E63', group: 'fitness', label: 'Gym' },
  sports_centre:   { color: '#E91E63', group: 'fitness', label: 'Sports Center' },
  swimming_pool:   { color: '#E91E63', group: 'fitness', label: 'Swimming Pool' },
}

export const POI_GROUP_COLORS = {
  dining: '#E67E22',
  attractions: '#8E44AD',
  parks: '#27AE60',
  lodging: '#2980B9',
  shops: '#16A085',
  healthcare: '#E74C3C',
  services: '#F1C40F',
  fitness: '#E91E63',
}

export const POI_FILES = [
  'restaurants', 'attractions', 'parks',
  'lodging', 'shops', 'healthcare', 'services', 'fitness',
]

// Always-visible main category toggles. Each pill matches POIs by raw OSM
// `properties.category` value and/or by `properties.tags` membership.
// Order is driven by `mainCategories.json` (shared with the Python pipeline so
// the filter-schema hash stays in sync).
const MAIN_POI_CATEGORY_DEFS = {
  restaurants: {
    label: 'restaurants',
    color: '#E67E22',
    matchCategories: ['restaurant', 'fast_food', 'ice_cream', 'bakery'],
    matchTags: [],
  },
  bars: {
    label: 'bars',
    color: '#9B59B6',
    matchCategories: ['bar', 'pub'],
    matchTags: ['brewery', 'winery', 'distillery', 'has-bar'],
  },
  coffee: {
    label: 'coffee',
    color: '#7B4A2A',
    matchCategories: ['cafe'],
    matchTags: ['coffee', 'coffee-shop', 'coffee-roaster'],
  },
  parks: {
    label: 'parks',
    color: '#2ECC71',
    matchCategories: ['park', 'playground', 'garden'],
    matchTags: [],
  },
}

export const MAIN_POI_CATEGORIES = MAIN_CATEGORY_IDS.map(id => ({
  id,
  ...MAIN_POI_CATEGORY_DEFS[id],
}))

export const MAIN_POI_CATEGORY_IDS = MAIN_CATEGORY_IDS

// Default-on main categories when no ?pois= filter is provided.
export const DEFAULT_ENABLED_MAIN_CATEGORIES = ['parks', 'coffee']

export const POI_INTERACTIVE_LAYERS = ['poi-circles']
