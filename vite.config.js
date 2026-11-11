import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { filterRegistry, includePreviewCities, previewSlugs } from './src/previewCities.js'

const REGISTRY = resolve(import.meta.dirname, 'src/cityRegistry.json')

/**
 * Strip preview cities from a public build.
 *
 * Two halves, because hiding one without the other leaks:
 *  - `transform` rewrites the city registry the bundle imports, so the public
 *    JS carries no trace of the city (not even its name or map centre).
 *  - `closeBundle` deletes the city's data from dist/, because Vite copies
 *    publicDir wholesale and would otherwise publish its stations, tiles and
 *    isochrones at a guessable path even with the UI hiding it.
 *
 * Set VITE_PREVIEW_CITIES=1 to build the gated preview, which includes them.
 */
function previewCities(includePreview) {
  let outDir = 'dist'
  return {
    name: 'walksheds:preview-cities',
    enforce: 'pre',
    configResolved(config) {
      outDir = config.build.outDir
    },
    transform(code, id) {
      if (includePreview) return null
      if (resolve(id.split('?')[0]) !== REGISTRY) return null
      const filtered = filterRegistry(JSON.parse(code), false)
      return { code: JSON.stringify(filtered), map: null }
    },
    closeBundle() {
      if (includePreview) return
      const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'))
      for (const slug of previewSlugs(registry, false)) {
        const dir = resolve(import.meta.dirname, outDir, 'cities', slug)
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true })
          this.info(`pruned preview city data: ${outDir}/cities/${slug}`)
        }
      }
    },
  }
}

/**
 * Preload the mapbox-gl chunk from the HTML.
 *
 * react-map-gl loads mapbox-gl with a dynamic `import()` that only runs once
 * the entry chunk has downloaded and executed, so the largest download
 * (~460 KB gzip) started late: about 1 s in on a mobile profile. A
 * modulepreload link lets the browser fetch it alongside the entry chunk. Kept
 * as its own chunk (not folded into the entry) so it stays cached across app
 * deploys.
 */
function preloadMapboxChunk() {
  let base = '/'
  return {
    name: 'walksheds:preload-mapbox',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle ?? {}).find(
          (c) => c.type === 'chunk' && c.name === 'mapbox-gl',
        )
        if (!chunk) return html
        return [{
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: '', href: `${base}${chunk.fileName}` },
          injectTo: 'head',
        }]
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  // Read straight from the environment rather than loadEnv: the flag is set by
  // the deploy workflow, not by a committed .env file.
  const includePreview = includePreviewCities(process.env)
  if (includePreview) {
    console.log(`[walksheds] ${mode} build INCLUDES preview cities`)
  }
  return {
    base: '/',
    plugins: [previewCities(includePreview), react(), basicSsl(), preloadMapboxChunk()],
    server: {
      port: 5187,
      strictPort: true,
      host: true,
      allowedHosts: ['.local'],
    },
  }
})
