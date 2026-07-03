/**
 * Walksheds embed helper — drop the map into any page with one script.
 *
 *   <div id="map" style="max-width:720px"></div>
 *   <script src="https://walksheds.xyz/embed.js"></script>
 *   <script>
 *     const w = Walksheds.embed('#map', {
 *       station: 'seattle/1/50',      // or { line: '1', stopCode: 50 }
 *       walkshed: [5, 10],            // enabled bands (minutes)
 *       pois: 'coffee,park',          // POI filters
 *       dark: false, units: 'metric',
 *       chrome: { legend: true, search: true },
 *       origin: location.origin,      // pin the postMessage peer (recommended)
 *       onReady: () => {},
 *       onStationChange: (s) => console.log(s.name),
 *     })
 *     // Drive it later:
 *     w.select('2', 58)        // Bellevue Downtown
 *     w.setWalksheds([5, 10, 15])
 *     w.setFilters('coffee,bar')
 *     w.setDark(true)
 *     w.setUnits('imperial')
 *   </script>
 *
 * Framework-free. The iframe is served from walksheds.xyz (keeping the Mapbox
 * token valid) and isolates the app's CSS/JS from the host page. See
 * https://wiki.walksheds.xyz/dev/ for the full protocol reference.
 */
(function (global) {
  var DEFAULT_BASE = 'https://walksheds.xyz/'
  var CHROME_KEYS = ['legend', 'search', 'hints', 'help', 'guide', 'report', 'locate', 'darkToggle', 'unitsToggle']
  var CHROME_PARAM = {
    legend: 'legend', search: 'search', hints: 'hints', help: 'help', guide: 'guide',
    report: 'report', locate: 'locate', darkToggle: 'darktoggle', unitsToggle: 'unitstoggle',
  }

  function stationPath(station) {
    if (!station) return ''
    if (typeof station === 'string') return station.replace(/^\/+/, '')
    if (station.line != null && station.stopCode != null) {
      return 'seattle/' + station.line + '/' + station.stopCode
    }
    return ''
  }

  function buildEmbedUrl(opts) {
    opts = opts || {}
    var url = new URL(stationPath(opts.station), opts.base || DEFAULT_BASE)
    var q = url.searchParams
    q.set('embed', '1')

    var chrome = opts.chrome || {}
    CHROME_KEYS.forEach(function (key) {
      if (chrome[key] != null) q.set(CHROME_PARAM[key], chrome[key] ? '1' : '0')
    })
    if (opts.dark != null) q.set('dark', opts.dark ? '1' : '0')
    if (opts.units) q.set('units', opts.units)
    if (opts.walkshed != null) {
      [].concat(opts.walkshed).forEach(function (m) { q.append('walkshed', m) })
    }
    if (opts.pois != null && opts.pois !== '') {
      q.set('pois', Array.isArray(opts.pois) ? opts.pois.join(',') : opts.pois)
    }
    if (opts.origin) q.set('origin', opts.origin)
    return url.toString()
  }

  function embed(target, opts) {
    opts = opts || {}
    var el = typeof target === 'string' ? document.querySelector(target) : target
    if (!el) throw new Error('Walksheds.embed: container "' + target + '" not found')

    var src = buildEmbedUrl(opts)
    var frameOrigin = new URL(src).origin

    var wrap = document.createElement('div')
    wrap.style.position = 'relative'
    wrap.style.width = '100%'
    if (opts.height != null) {
      wrap.style.height = typeof opts.height === 'number' ? opts.height + 'px' : opts.height
    } else {
      // Responsive aspect box so the map keeps a sensible shape without a fixed height.
      wrap.style.aspectRatio = opts.aspect ? String(opts.aspect) : '4 / 3'
    }

    var frame = document.createElement('iframe')
    frame.src = src
    frame.title = 'Walksheds — Seattle Link Light Rail walkshed explorer'
    frame.loading = 'lazy'
    frame.setAttribute('allow', 'geolocation; gyroscope; magnetometer')
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block'
    wrap.appendChild(frame)
    el.appendChild(wrap)

    function onMessage(e) {
      if (e.source !== frame.contentWindow) return
      if (e.origin !== frameOrigin) return
      var d = e.data
      if (!d || d.source !== 'walksheds') return
      if (d.type === 'ready' && opts.onReady) opts.onReady(d.payload)
      else if (d.type === 'stationchange' && opts.onStationChange) opts.onStationChange(d.payload)
    }
    global.addEventListener('message', onMessage)

    function post(type, payload) {
      if (frame.contentWindow) {
        frame.contentWindow.postMessage({ source: 'walksheds-host', type: type, payload: payload || {} }, frameOrigin)
      }
    }

    return {
      iframe: frame,
      url: src,
      select: function (line, stopCode) { post('selectStation', { line: line, stopCode: stopCode }) },
      setWalksheds: function (minutes) { post('setWalksheds', { minutes: [].concat(minutes) }) },
      setFilters: function (pois) { post('setFilters', { pois: Array.isArray(pois) ? pois.join(',') : pois }) },
      setDark: function (dark) { post('setDark', { dark: !!dark }) },
      setUnits: function (units) { post('setUnits', { units: units }) },
      destroy: function () { global.removeEventListener('message', onMessage); wrap.remove() },
    }
  }

  global.Walksheds = global.Walksheds || {}
  global.Walksheds.embed = embed
  global.Walksheds.buildEmbedUrl = buildEmbedUrl
})(window);
