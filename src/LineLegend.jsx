import { useRef, useCallback, useState } from 'react'
import { buildSiteFeedbackIssueUrl, SITE_FEEDBACK_REASONS } from './siteFeedback'

const WALKSHED_ITEMS = [
  { minutes: 5, label: '5 min walk' },
  { minutes: 10, label: '10 min walk' },
  { minutes: 15, label: '15 min walk' },
]

const WALKSHED_OPACITIES = { 5: 0.7, 10: 0.45, 15: 0.25 }

function UnitsToggle({ units, onToggle, className }) {
  const next = units === 'imperial' ? 'metric' : 'imperial'
  return (
    <button
      className={className}
      onClick={onToggle}
      aria-label={`Switch units to ${next === 'imperial' ? 'imperial (miles, feet)' : 'metric (km, meters)'}`}
      title={`Distance units: ${units === 'imperial' ? 'mi/ft' : 'km/m'} — click to switch`}
    >
      <span className="legend-units-text">{units === 'imperial' ? 'mi' : 'km'}</span>
    </button>
  )
}

const HELP_ICON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M6 6.2a2 2 0 1 1 2.5 1.9c-.3.1-.5.4-.5.7V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
    <circle cx="8" cy="11.5" r="0.7" fill="currentColor"/>
  </svg>
)

// Open-book glyph linking to the reader-facing guide at wiki.walksheds.xyz.
const WIKI_ICON = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path d="M8 4.2C8 4.2 6.6 3.2 4.1 3.2C3.2 3.2 2.4 3.4 2.4 3.4V12.6C2.4 12.6 3.2 12.4 4.1 12.4C6.6 12.4 8 13.4 8 13.4M8 4.2C8 4.2 9.4 3.2 11.9 3.2C12.8 3.2 13.6 3.4 13.6 3.4V12.6C13.6 12.6 12.8 12.4 11.9 12.4C9.4 12.4 8 13.4 8 13.4M8 4.2V13.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const WIKI_URL = 'https://wiki.walksheds.xyz'

// Speech-bubble glyph for the "Send feedback" control — drawn in the same
// inline-SVG idiom as HELP_ICON / WIKI_ICON so it reads as house iconography,
// not an emoji (INV-018).
const FEEDBACK_ICON = (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 3.5h11v7h-6l-3 2.5V10.5h-2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Current page context, captured for the feedback issue body. Guarded so the
// component still renders under jsdom/SSR (window/navigator may be partial).
function feedbackContext() {
  if (typeof window === 'undefined') return {}
  return {
    url: window.location?.href ?? '',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  }
}

export default function LineLegend({
  lineColors,
  enabledWalksheds,
  walkshedAccent,
  onWalkshedToggle,
  darkMode,
  onDarkModeToggle,
  units,
  onUnitsToggle,
  collapsed,
  onToggleCollapse,
  onHintsToggle,
  position,
  showHelp = true,
  showGuide = true,
  showDark = true,
  showFeedback = true,
}) {
  const posClass = position === 'bottom-right' ? 'bottom-right' : ''
  const touchStartY = useRef(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const handleTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0].clientY
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (touchStartY.current === null) return
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    const threshold = 30
    if (collapsed && deltaY < -threshold) {
      onToggleCollapse()
    } else if (!collapsed && deltaY > threshold) {
      onToggleCollapse()
    }
    touchStartY.current = null
  }, [collapsed, onToggleCollapse])

  const swipeProps = {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
  }

  if (collapsed) {
    return (
      <div className={`line-legend collapsed ${posClass}`} {...swipeProps}>
        {showDark && (
          <button className="legend-dark-toggle-inline" onClick={onDarkModeToggle} aria-label="Toggle dark mode">
            {darkMode ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M14 9.6A6.5 6.5 0 016.4 2 6 6 0 1014 9.6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        )}
          {onUnitsToggle && (
            <UnitsToggle units={units} onToggle={onUnitsToggle} className="legend-units-toggle-inline" />
          )}
          {showHelp && (
            <button className="legend-dark-toggle-inline" onClick={onHintsToggle} aria-label="Toggle hints" data-hint-keep="true">
              {HELP_ICON}
            </button>
          )}
          {showGuide && (
            <a
              className="legend-dark-toggle-inline legend-wiki-link"
              href={WIKI_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open the Walksheds guide (opens in a new tab)"
              title="Walksheds guide — wiki.walksheds.xyz"
              data-hint-keep="true"
            >
              {WIKI_ICON}
            </a>
          )}
          <div className="legend-collapsed-divider" />
          <div className="legend-collapsed-walksheds">
            {WALKSHED_ITEMS.map(({ minutes }) => {
              const enabled = enabledWalksheds.has(minutes)
              return (
                <button
                  key={minutes}
                  className={`legend-collapsed-dot ${enabled ? '' : 'dimmed'}`}
                  onClick={() => onWalkshedToggle(minutes)}
                  aria-label={`${minutes} min walkshed`}
                >
                  <span
                    className="legend-swatch legend-swatch-walkshed"
                    style={{
                      background: walkshedAccent,
                      opacity: enabled ? WALKSHED_OPACITIES[minutes] : 0.05,
                    }}
                  />
                  <span className="legend-collapsed-label">{minutes}m</span>
                </button>
              )
            })}
          </div>
        <div className="legend-collapsed-divider" />
        <button className="legend-expand-btn" onClick={onToggleCollapse} aria-label="Expand legend" data-hint-keep="true">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className={`line-legend ${posClass}`} {...swipeProps}>
      <div className="legend-header">
        {showDark && (
          <button className="legend-header-btn" onClick={onDarkModeToggle} aria-label="Toggle dark mode">
            {darkMode ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M14 9.6A6.5 6.5 0 016.4 2 6 6 0 1014 9.6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        )}
        {onUnitsToggle && (
          <UnitsToggle units={units} onToggle={onUnitsToggle} className="legend-header-btn legend-units-toggle" />
        )}
        {showHelp && (
          <button className="legend-header-btn" onClick={onHintsToggle} aria-label="Toggle hints" data-hint-keep="true">
            {HELP_ICON}
          </button>
        )}
        {showGuide && (
          <a
            className="legend-header-btn legend-wiki-link"
            href={WIKI_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the Walksheds guide (opens in a new tab)"
            title="Walksheds guide — wiki.walksheds.xyz"
            data-hint-keep="true"
          >
            {WIKI_ICON}
          </a>
        )}
        <h3 className="legend-title">Legend</h3>
        <button className="legend-header-btn" onClick={onToggleCollapse} aria-label="Collapse legend" data-hint-keep="true">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div className="legend-lines">
        <div className="legend-line-item">
          <span className="legend-line-circle" style={{ background: lineColors['1-line'].color }}>1</span>
          <span className="legend-line-label">{lineColors['1-line'].label}</span>
        </div>
        <div className="legend-line-item">
          <span className="legend-line-circle" style={{ background: lineColors['2-line'].color }}>2</span>
          <span className="legend-line-label">{lineColors['2-line'].label}</span>
        </div>
      </div>

      <div className="legend-station-example">
        <div className="legend-pill">
          <span className="legend-pill-circle" style={{ background: lineColors['1-line'].color }}>1</span>
          <span className="legend-pill-circle" style={{ background: lineColors['2-line'].color }}>2</span>
          <span className="legend-pill-code">50</span>
        </div>
        <span className="legend-station-desc">Station</span>
      </div>

      <div className="legend-divider" />

      <h3 className="legend-title">Walksheds</h3>
      <div className="legend-walkshed-list">
        {WALKSHED_ITEMS.map(({ minutes, label }) => {
          const enabled = enabledWalksheds.has(minutes)
          return (
            <button
              key={minutes}
              className={`legend-walkshed-item ${enabled ? '' : 'dimmed'}`}
              onClick={() => onWalkshedToggle(minutes)}
            >
              <span
                className="legend-swatch legend-swatch-walkshed"
                style={{
                  background: walkshedAccent,
                  opacity: enabled ? WALKSHED_OPACITIES[minutes] : 0.05,
                }}
              />
              <span className="legend-walkshed-label">{label}</span>
            </button>
          )
        })}
      </div>

      {showFeedback && (
        <>
          <div className="legend-divider" />
          <div className="legend-feedback">
            <button
              className="legend-feedback-trigger"
              onClick={() => setFeedbackOpen(v => !v)}
              aria-expanded={feedbackOpen}
            >
              {FEEDBACK_ICON}
              Send feedback
            </button>
            {feedbackOpen && (
              <div className="legend-feedback-reasons" role="group" aria-label="Send feedback">
                {SITE_FEEDBACK_REASONS.map(r => (
                  <a
                    key={r.key}
                    className="legend-feedback-reason"
                    href={buildSiteFeedbackIssueUrl(r.key, feedbackContext())}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setFeedbackOpen(false)}
                  >
                    {r.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </>
      )}

    </div>
  )
}
