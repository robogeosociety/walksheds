const STORAGE_KEY = 'walksheds_hints_v1_seen'

function safeStorage() {
  try {
    if (typeof window === 'undefined') return null
    const ls = window.localStorage
    if (!ls || typeof ls.getItem !== 'function') return null
    return ls
  } catch {
    return null
  }
}

export function shouldShowHints() {
  if (typeof window === 'undefined') return false
  // ?hints forces hints regardless of storage or deep link
  const params = new URLSearchParams(window.location.search)
  if (params.has('hints')) return true
  // Embedded views never show onboarding (unless ?hints forced it above).
  if (params.has('embed')) return false
  const ls = safeStorage()
  if (ls && ls.getItem(STORAGE_KEY)) return false
  // Skip hints for deep-linked visits — shared links shouldn't surface onboarding
  const base = import.meta.env.BASE_URL
  const path = window.location.pathname
  const normalized = path.endsWith('/') ? path : path + '/'
  const baseNormalized = base.endsWith('/') ? base : base + '/'
  if (normalized !== baseNormalized) return false
  return true
}

export function markHintsSeen() {
  const ls = safeStorage()
  if (ls) {
    try { ls.setItem(STORAGE_KEY, '1') } catch { /* private mode */ }
  }
  // Strip ?hints from the URL so a page refresh doesn't replay
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href)
    if (url.searchParams.has('hints')) {
      url.searchParams.delete('hints')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  }
}
