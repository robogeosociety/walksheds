#!/usr/bin/env node
/**
 * Walksheds page-load latency suite.
 *
 * Loads the app in headless Chromium, cold (fresh context) and warm (reload in
 * the same context), under a set of device/network profiles, and records when
 * each step of the load chain lands, in ms from navigation start:
 *
 *   ttfb -> fcp -> appJs -> mapStyle -> mapLoad -> isochroneStart
 *        -> isochroneEnd -> poiTilesEnd -> settled
 *
 * The app exposes no timing hooks, so milestones are read from the network:
 *   mapLoad        the station sprite manifest request (MapView registers the
 *                  station icons in its map-load effect, so it fires on load)
 *   isochroneStart first Mapbox Isochrone request (a station got selected)
 *   isochroneEnd   last Isochrone response
 *   walkshedData   walkshed polygons received, from the Isochrone API or the
 *                  city's committed walksheds.json
 *   poiTilesEnd    last POI tile response
 *   selected       the selected station's name pill appears (DOM)
 *   poisFirst      app mark: the first batch of the walkshed's POIs committed
 *                  for drawing (streamed builds draw before every tile lands)
 *   poisComplete   app mark: every POI tile landed and committed
 *   poisVisible    max(selected, walkshedData, poiTilesEnd): the walkshed's
 *                  POI dots can draw
 *   settled        last network response before a quiet window (map tiles
 *                  for the framed walkshed included): "visually complete"
 *
 * Targets:
 *   --url <origin>   a deployed site (default https://walksheds.xyz)
 *   --dist <dir>     a local build, served AS https://walksheds.xyz via request
 *                    interception, so the origin-restricted Mapbox token in
 *                    that build works. Use this to compare builds (regression
 *                    hunting, verifying a fix) under identical conditions.
 *                    Same-origin assets skip CDN latency and are counted at
 *                    their gzip size; --origin-rtt adds a fixed delay per
 *                    same-origin request.
 *
 * Usage:
 *   node perf/latency.mjs [--url URL | --dist DIR] [--runs 5]
 *        [--profiles desktop,mobile] [--path /] [--label name] [--out file.json]
 *        [--block REGEX]   abort matching requests (what-if experiments)
 *        [--serve DIR]     a local build over real local HTTPS (throttled like
 *                          the live site; see startLocalServer)
 *        [--navigate KEY]  after the cold load, press KEY and time the next
 *                          station's POIs (see measureNavigation)
 *
 * Numbers from a cloud runner include its egress latency; compare runs taken
 * from the same machine, not against field data.
 */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://walksheds.xyz' },
    dist: { type: 'string' },
    serve: { type: 'string' },
    runs: { type: 'string', default: '5' },
    profiles: { type: 'string', default: 'desktop,mobile' },
    path: { type: 'string', default: '/' },
    label: { type: 'string' },
    out: { type: 'string' },
    'origin-rtt': { type: 'string', default: '0' },
    'quiet-ms': { type: 'string', default: '2500' },
    'timeout-ms': { type: 'string', default: '60000' },
    'no-warm': { type: 'boolean', default: false },
    navigate: { type: 'string' },
    block: { type: 'string' },
  },
})

const LOCAL = args.dist || args.serve
const ORIGIN = LOCAL ? 'https://walksheds.xyz' : args.url.replace(/\/$/, '')
const RUNS = Number(args.runs)
const QUIET_MS = Number(args['quiet-ms'])
const TIMEOUT_MS = Number(args['timeout-ms'])
const ORIGIN_RTT = Number(args['origin-rtt'])

// Lighthouse's mobile preset (Moto G Power on "Slow 4G"): 150 ms RTT,
// 1.6 Mbps down, 750 Kbps up, 4x CPU slowdown.
const PROFILES = {
  desktop: {
    context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    network: null,
    cpu: 1,
  },
  mobile: {
    context: {
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    },
    network: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
    cpu: 4,
  },
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.geojson': 'application/geo+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.woff2': 'font/woff2',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.geojson', '.svg', '.txt', '.webmanifest'])

/**
 * --serve mode: a real local HTTPS server for a build, which Chromium reaches
 * as walksheds.xyz (host-resolver rule + proxy bypass). Unlike --dist, its
 * responses are real network requests, so profile throttling applies to the
 * app's own files and they contend with Mapbox's for the same emulated link.
 * Gzip and cache headers mirror GitHub Pages. The certificate is a throwaway
 * self-signed one (the browser context ignores HTTPS errors).
 */
async function startLocalServer(dist) {
  const root = resolve(dist)
  const dir = mkdtempSync(join(tmpdir(), 'walksheds-latency-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=walksheds.xyz', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' })
  const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    const url = new URL(req.url, ORIGIN)
    let file = join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root)) { res.writeHead(403).end(); return }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    let status = 200
    if (!existsSync(file)) {
      const notFound = join(root, '404.html')
      status = existsSync(notFound) ? 404 : 200
      file = existsSync(notFound) ? notFound : join(root, 'index.html')
    }
    const ext = extname(file)
    let body = readFileSync(file)
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'max-age=600' }
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body)
      headers['content-encoding'] = 'gzip'
    }
    headers['content-length'] = body.length
    res.writeHead(status, headers).end(body)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { port: server.address().port, close: () => { server.close(); rmSync(dir, { recursive: true, force: true }) } }
}

// --dist mode: request URL -> bytes GitHub Pages would put on the wire.
const distWireBytes = new Map()

/** Serve a local dist/ as ORIGIN, the way GitHub Pages would (SPA 404 fallback). */
async function serveDist(context, dist) {
  const root = resolve(dist)
  await context.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    let file = join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root)) return route.fulfill({ status: 403 })
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    let status = 200
    if (!existsSync(file)) {
      // GitHub Pages serves 404.html for unknown paths; the SPA restores the
      // route from it. Fall back to index.html when the build has no 404.html.
      const notFound = join(root, '404.html')
      file = existsSync(notFound) ? notFound : join(root, 'index.html')
      status = existsSync(notFound) ? 404 : 200
    }
    const ext = extname(file)
    const body = readFileSync(file)
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'max-age=600' }
    // Chromium does not decode Content-Encoding on intercepted responses, so
    // the body goes out raw; byte accounting uses the gzip size Pages ships.
    distWireBytes.set(url.href, COMPRESSIBLE.has(ext) ? gzipSync(body).length : body.length)
    if (ORIGIN_RTT) await new Promise(r => setTimeout(r, ORIGIN_RTT))
    return route.fulfill({ status, headers, body })
  })
}

/** In-page collectors: paint, LCP, long tasks, plus first-seen times for key DOM nodes. */
const INIT_SCRIPT = `(() => {
  const m = (window.__lat = { lcp: 0, longTasks: [], seen: {} })
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) m.lcp = e.startTime })
      .observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver(l => { for (const e of l.getEntries()) m.longTasks.push([e.startTime, e.duration]) })
      .observe({ type: 'longtask', buffered: true })
  } catch {}
  // The selected station's name pill is the only .station-pill inside a map Marker.
  const watch = { canvas: '.mapboxgl-canvas', selected: '.mapboxgl-marker .station-pill' }
  const check = () => {
    for (const [k, sel] of Object.entries(watch)) {
      if (!m.seen[k] && document.querySelector(sel)) m.seen[k] = performance.now()
    }
  }
  new MutationObserver(check).observe(document, { childList: true, subtree: true })
})()`

function classify(url) {
  const u = new URL(url)
  if (u.hostname.endsWith('mapbox.com')) {
    if (u.pathname.startsWith('/isochrone/')) return 'mapbox-isochrone'
    if (u.pathname.startsWith('/styles/')) return 'mapbox-style'
    if (u.pathname.startsWith('/fonts/')) return 'mapbox-glyphs'
    if (u.pathname.includes('/models/') || u.pathname.includes('.glb')) return 'mapbox-models'
    if (u.hostname.startsWith('events')) return 'mapbox-telemetry'
    if (u.pathname.includes('/v4/') || u.pathname.includes('/tiles/') || u.pathname.includes('.vector.pbf') || u.pathname.includes('.mvt')) return 'mapbox-tiles'
    return 'mapbox-other'
  }
  if (u.hostname.includes('googleapis.com') || u.hostname.includes('gstatic.com')) return 'google-fonts'
  if (url.startsWith(ORIGIN)) {
    if (/\/assets\/.*\.js$/.test(u.pathname)) return 'app-js'
    if (/\/assets\/.*\.css$/.test(u.pathname)) return 'app-css'
    if (/\/cities\/[^/]+\/walksheds\.json$/.test(u.pathname)) return 'walkshed-data'
    if (/\/pois\/tiles\/[-\d]+_[-\d]+\.geojson$/.test(u.pathname)) return 'poi-tiles'
    if (u.pathname.includes('/pois/')) return 'poi-meta'
    if (u.pathname.includes('/icons/')) return 'station-sprites'
    if (u.pathname.startsWith('/cities/') || u.pathname.endsWith('.geojson')) return 'transit-data'
    return 'app-other'
  }
  return 'other'
}

async function measure(context, page, profile, navStart) {
  const reqs = new Map() // request -> record
  const onReq = (req) => {
    // blob:/data: URLs never report completion; they are not network requests.
    if (!/^https?:/.test(req.url())) return
    reqs.set(req, { url: req.url(), kind: classify(req.url()), start: Date.now() - navStart, end: null, failed: false })
  }
  const onDone = (req) => { const r = reqs.get(req); if (r) r.end = Date.now() - navStart }
  const onFail = (req) => { const r = reqs.get(req); if (r) { r.end = Date.now() - navStart; r.failed = true } }
  page.on('request', onReq)
  page.on('requestfinished', onDone)
  page.on('requestfailed', onFail)

  const goto = page.goto(ORIGIN + args.path, { waitUntil: 'commit', timeout: TIMEOUT_MS })
  await goto

  // Settle: wait for the POI-bearing walkshed chain, then a quiet network window.
  const deadline = Date.now() + TIMEOUT_MS
  let lastActivity = Date.now()
  let lastCount = 0
  let timedOut = false
  for (;;) {
    await page.waitForTimeout(100)
    const all = [...reqs.values()].filter(r => r.kind !== 'mapbox-telemetry')
    const inflight = all.filter(r => r.end == null).length
    const activity = all.length + all.filter(r => r.end != null).length
    if (activity !== lastCount || inflight > 0) { lastCount = activity; lastActivity = Date.now() }
    // Walkshed polygons arrive from the Isochrone API or, since they were
    // committed, from the city's walksheds.json; POI tiles follow either way.
    const sawWalkshed = all.some(r => ['mapbox-isochrone', 'walkshed-data', 'poi-tiles'].includes(r.kind) && r.end != null)
    if (sawWalkshed && inflight === 0 && Date.now() - lastActivity >= QUIET_MS) break
    if (Date.now() > deadline) { timedOut = true; break }
  }

  page.off('request', onReq)
  page.off('requestfinished', onDone)
  page.off('requestfailed', onFail)

  const inPage = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    return {
      ttfb: nav?.responseStart ?? null,
      dcl: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
      fcp: fcp?.startTime ?? null,
      lcp: window.__lat?.lcp || null,
      longTasks: window.__lat?.longTasks ?? [],
      seen: window.__lat?.seen ?? {},
      timeOrigin: performance.timeOrigin,
      // App-side User Timing marks (builds from #110 on); absent in older builds.
      marks: Object.fromEntries(['pois-first', 'pois-complete'].map((n) => {
        const m = performance.getEntriesByName(`walksheds:${n}`, 'mark')[0]
        return [n, m ? m.startTime : null]
      })),
    }
  })

  // Byte sizes (encoded, on the wire) for every request that finished.
  const records = []
  for (const [req, r] of reqs) {
    let bytes = 0
    if (r.end != null && !r.failed && distWireBytes.has(r.url)) {
      bytes = distWireBytes.get(r.url)
    } else if (r.end != null && !r.failed) {
      try {
        const s = await req.sizes()
        bytes = s.responseBodySize + s.responseHeadersSize
      } catch { /* request from a closed target */ }
    }
    records.push({ ...r, bytes })
  }
  // Re-base Node-side timestamps onto the page's navigation timeOrigin.
  const skew = navStart - inPage.timeOrigin
  for (const r of records) {
    r.start = Math.round(r.start + skew)
    if (r.end != null) r.end = Math.round(r.end + skew)
  }

  const of = (kind) => records.filter(r => r.kind === kind)
  const minStart = (rs) => (rs.length ? Math.min(...rs.map(r => r.start)) : null)
  const maxEnd = (rs) => { const e = rs.filter(r => r.end != null).map(r => r.end); return e.length ? Math.max(...e) : null }
  const sprite = records.filter(r => r.kind === 'station-sprites' && r.url.endsWith('.json'))
  const settledAt = maxEnd(records.filter(r => r.kind !== 'mapbox-telemetry'))
  const tbt = inPage.longTasks
    .filter(([s]) => settledAt == null || s <= settledAt)
    .reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0)

  const byKind = {}
  for (const r of records) {
    const k = (byKind[r.kind] ??= { count: 0, bytes: 0 })
    k.count++
    k.bytes += r.bytes
  }

  const walkshedData = maxEnd([...of('mapbox-isochrone'), ...of('walkshed-data')])
  const poiTilesEnd = maxEnd(of('poi-tiles'))
  const selected = inPage.seen.selected ?? null
  // POI dots draw once the station is selected AND its walkshed and tiles are
  // in (each can come first, depending on the build).
  const poisVisible = [selected, walkshedData, poiTilesEnd].every(x => x != null)
    ? Math.max(selected, walkshedData, poiTilesEnd)
    : null

  return {
    timedOut,
    milestones: {
      ttfb: inPage.ttfb,
      fcp: inPage.fcp,
      lcp: inPage.lcp,
      dcl: inPage.dcl,
      appJs: maxEnd(of('app-js')),
      canvas: inPage.seen.canvas ?? null,
      mapStyle: maxEnd(of('mapbox-style')),
      mapLoad: minStart(sprite),
      isochroneStart: minStart(of('mapbox-isochrone')),
      isochroneEnd: maxEnd(of('mapbox-isochrone')),
      walkshedData,
      poiTilesEnd,
      selected,
      poisVisible,
      poisFirst: inPage.marks['pois-first'],
      poisComplete: inPage.marks['pois-complete'],
      settled: settledAt,
    },
    tbt: Math.round(tbt),
    // Per-request waterfall. Tokens are redacted so results can be committed.
    waterfall: records
      .sort((a, b) => a.start - b.start)
      .map(r => ({ kind: r.kind, url: r.url.replace(/access_token=[^&]+/, 'access_token=REDACTED'), start: r.start, end: r.end, bytes: r.bytes, failed: r.failed || undefined })),
    longTaskCount: inPage.longTasks.length,
    requests: records.length,
    bytes: records.reduce((s, r) => s + r.bytes, 0),
    byKind,
    profile,
  }
}

/**
 * --navigate KEY: after the cold load settles, press KEY (e.g. ArrowUp, the
 * next station north) and time the new station's POIs from the keypress:
 *   navTilesEnd     last POI tile response (resource timing; any build)
 *   navPoisFirst    app mark: first batch committed for drawing
 *   navPoisComplete app mark: last batch committed
 * Pre-streaming builds draw only once every tile lands, so compare their
 * navTilesEnd with a streamed build's navPoisFirst.
 */
async function measureNavigation(page, key) {
  const t0 = await page.evaluate(() => performance.now())
  await page.keyboard.press(key)
  await page.waitForFunction(
    (t) => performance.getEntriesByName('walksheds:pois-complete', 'mark').some(m => m.startTime > t),
    t0, { timeout: 15000 },
  ).catch(() => {})
  // Builds without marks: wait for the tile requests to go quiet instead.
  let last = -1
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => performance.getEntriesByType('resource').length)
    if (n === last) break
    last = n
    await page.waitForTimeout(500)
  }
  return page.evaluate((t) => {
    const after = (name) => {
      const m = performance.getEntriesByName(`walksheds:${name}`, 'mark').find(e => e.startTime > t)
      return m ? Math.round(m.startTime - t) : null
    }
    const tiles = performance.getEntriesByType('resource')
      .filter(e => e.startTime > t && /\/pois\/tiles\/[-\d]+_[-\d]+\.geojson$/.test(e.name))
    return {
      navTilesEnd: tiles.length ? Math.round(Math.max(...tiles.map(e => e.responseEnd)) - t) : null,
      navPoisFirst: after('pois-first'),
      navPoisComplete: after('pois-complete'),
    }
  }, t0)
}

async function applyProfile(context, page, p) {
  if (!p.network && p.cpu === 1) return
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  if (p.network) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.network })
  if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
}

async function runOnce(browser, profileName, warm) {
  const p = PROFILES[profileName]
  const context = await browser.newContext({ ...p.context, ignoreHTTPSErrors: true })
  // Fresh context = a true first visit (empty storage, so the hint overlay shows).
  await context.addInitScript(INIT_SCRIPT)
  if (args.block) {
    // What-if experiments: abort requests matching a regex (e.g. terrain DEM
    // tiles) to estimate what removing them would save.
    const re = new RegExp(args.block)
    await context.route(u => re.test(u.href), route => route.abort('blockedbyclient'))
  }
  if (args.dist) await serveDist(context, args.dist)
  const page = await context.newPage()
  await applyProfile(context, page, p)
  let result = await measure(context, page, profileName, Date.now())
  if (args.navigate && !warm) Object.assign(result.milestones, await measureNavigation(page, args.navigate))
  if (warm) {
    // Second visit in the same context: HTTP cache primed, JS heap fresh.
    result = await measure(context, page, profileName, Date.now())
  }
  await context.close()
  return result
}

const median = (xs) => {
  const v = xs.filter(x => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}
const p90 = (xs) => {
  const v = xs.filter(x => x != null).sort((a, b) => a - b)
  return v.length ? v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)] : null
}

function summarize(runs) {
  const keys = Object.keys(runs[0].milestones)
  const milestones = {}
  for (const k of keys) {
    const xs = runs.map(r => r.milestones[k])
    milestones[k] = { median: median(xs) == null ? null : Math.round(median(xs)), p90: p90(xs) == null ? null : Math.round(p90(xs)) }
  }
  const byKind = {}
  for (const r of runs) for (const [k, v] of Object.entries(r.byKind)) {
    (byKind[k] ??= { count: [], bytes: [] }).count.push(v.count)
    byKind[k].bytes.push(v.bytes)
  }
  for (const k of Object.keys(byKind)) byKind[k] = { count: median(byKind[k].count), bytes: Math.round(median(byKind[k].bytes)) }
  return {
    n: runs.length,
    timedOut: runs.filter(r => r.timedOut).length,
    milestones,
    tbt: Math.round(median(runs.map(r => r.tbt))),
    requests: median(runs.map(r => r.requests)),
    bytes: Math.round(median(runs.map(r => r.bytes))),
    byKind,
  }
}

const fmtMs = (x) => (x == null ? '-' : `${(x / 1000).toFixed(2)}s`)
const fmtKB = (b) => `${(b / 1024).toFixed(0)} KB`

function printReport(report) {
  console.log(`\n# ${report.label}  (${report.target})`)
  for (const [key, s] of Object.entries(report.results)) {
    console.log(`\n## ${key}  n=${s.n}${s.timedOut ? `  TIMEOUTS=${s.timedOut}` : ''}`)
    console.log('milestone        median     p90')
    for (const [m, v] of Object.entries(s.milestones)) {
      console.log(`${m.padEnd(16)} ${fmtMs(v.median).padStart(7)} ${fmtMs(v.p90).padStart(7)}`)
    }
    console.log(`TBT ${s.tbt} ms · ${s.requests} requests · ${fmtKB(s.bytes)} on the wire`)
    const kinds = Object.entries(s.byKind).sort((a, b) => b[1].bytes - a[1].bytes)
    for (const [k, v] of kinds) console.log(`  ${k.padEnd(18)} ${String(v.count).padStart(4)} req ${fmtKB(v.bytes).padStart(9)}`)
  }
}

const local = args.serve ? await startLocalServer(args.serve) : null
const browserArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
if (local) {
  // walksheds.xyz resolves to the local server and bypasses any proxy; every
  // other host (Mapbox) keeps its normal route.
  browserArgs.push(`--host-resolver-rules=MAP walksheds.xyz 127.0.0.1:${local.port}`)
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  if (proxy) browserArgs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=walksheds.xyz')
}
const browser = await chromium.launch({
  // CHROMIUM_PATH: a system Chromium when Playwright's pinned build is absent.
  executablePath: process.env.CHROMIUM_PATH || undefined,
  // Software GL: headless runners have no GPU. Same for every target, so
  // comparisons hold, but absolute render times are pessimistic.
  args: browserArgs,
})
const report = {
  label: args.label ?? (LOCAL ? `${args.serve ? 'serve' : 'dist'}:${LOCAL}` : ORIGIN),
  target: LOCAL ? `${LOCAL} ${args.serve ? 'served over local HTTPS' : 'intercepted'} as ${ORIGIN}` : ORIGIN,
  path: args.path,
  when: new Date().toISOString(),
  results: {},
  raw: {},
}
for (const profileName of args.profiles.split(',')) {
  for (const warm of args['no-warm'] ? [false] : [false, true]) {
    const key = `${profileName}-${warm ? 'warm' : 'cold'}`
    const runs = []
    for (let i = 0; i < RUNS; i++) {
      const r = await runOnce(browser, profileName, warm)
      runs.push(r)
      process.stderr.write(`${key} run ${i + 1}/${RUNS}: settled ${fmtMs(r.milestones.settled)}${r.timedOut ? ' (timeout)' : ''}\n`)
    }
    report.results[key] = summarize(runs)
    report.raw[key] = runs
  }
}
await browser.close()
local?.close()
printReport(report)
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2))
