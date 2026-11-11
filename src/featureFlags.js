/**
 * Build-time feature flags. A flag is on only when its env var is exactly "1"
 * at build (or dev-server) time, e.g. `VITE_FEATURE_HINTS=1 npm run dev`.
 * Read through functions, not constants, so tests can stub the env.
 */

/**
 * The onboarding hint overlay (first-visit hand-drawn hints, the legend's
 * "Toggle hints" button, and the `?hints` URL override). Off by default.
 */
export function hintsEnabled(env = import.meta.env) {
  return env.VITE_FEATURE_HINTS === '1'
}
