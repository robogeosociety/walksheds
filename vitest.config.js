import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // The suite asserts behaviour for every registered city, preview ones
    // included — the public build's filtering is covered by its own unit tests
    // against filterRegistry/previewSlugs instead.
    env: { VITE_PREVIEW_CITIES: '1' },
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
})
