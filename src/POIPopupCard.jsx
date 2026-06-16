import { useState } from 'react'
import { POI_CATEGORIES } from './constants'
import { StationPillBody } from './StationPill'
import { formatWalk } from './formatDistance'
import { nearestExit, exitCode } from './stationExits'
import CategoryIcon from './poiIcons'

// Expandable POI card (issue #19), styled to match the legend: a category
// roundel header, capped tag list, and a vertical stack of info rows
// (address / hours / phone / website) that grows via a "more" toggle when
// a POI carries more than COLLAPSED_* fields. Rendered inside the map
// Popup by POILayer; extracted here so it can be unit-tested without a
// Mapbox context.

const COLLAPSED_TAGS = 4
const COLLAPSED_INFO_ROWS = 2

const INFO_ICONS = {
  // Map pin
  address: 'M12 20s-5.5-5-5.5-9.2A5.5 5.5 0 0 1 12 5.5a5.5 5.5 0 0 1 5.5 5.3C17.5 15 12 20 12 20z M12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  // Clock
  hours: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8v4.5l3 1.8',
  // Phone handset
  phone: 'M7 4.5l2.5 1 .8 3.2-1.8 1.6a11 11 0 0 0 5.2 5.2l1.6-1.8 3.2.8 1 2.5c-.5 1.5-2 2.5-3.5 2.2C10.3 18.5 5.5 13.7 4.8 7.9 4.6 6.4 5.6 5 7 4.5z',
  // Globe
  website: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M4 12h16 M12 4c2.2 2.2 3.2 5 3.2 8s-1 5.8-3.2 8c-2.2-2.2-3.2-5-3.2-8s1-5.8 3.2-8z',
}

function InfoIcon({ kind }) {
  return (
    <svg className="poi-popup-info-icon" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <path d={INFO_ICONS[kind]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function websiteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Website'
  }
}

// Build the ordered list of info rows present on this POI. Each entry
// renders as an icon + content line; the card shows the first
// COLLAPSED_INFO_ROWS and tucks the rest behind the "more" toggle.
function buildInfoRows(poi) {
  const rows = []
  if (poi.address) {
    rows.push({ kind: 'address', content: <span className="poi-popup-info-text">{poi.address}</span> })
  }
  if (poi.hours) {
    rows.push({ kind: 'hours', content: <span className="poi-popup-info-text">{poi.hours}</span> })
  }
  if (poi.phone) {
    rows.push({
      kind: 'phone',
      content: <a className="poi-popup-info-link" href={`tel:${poi.phone}`}>{poi.phone}</a>,
    })
  }
  if (poi.website) {
    rows.push({
      kind: 'website',
      content: (
        <a className="poi-popup-info-link" href={poi.website} target="_blank" rel="noopener noreferrer">
          {websiteLabel(poi.website)}
        </a>
      ),
    })
  }
  return rows
}

// The green "EXIT" badge for the station's best exit to this POI, rendered
// inline with the roundel so the card tells the rider which door to leave by.
function ExitBadge({ exit }) {
  return (
    <span className="poi-popup-exit-badge" aria-label={`best exit ${exitCode(exit)}`}>
      <span className="exit-badge-exit">EXIT</span>
      <span className="exit-badge-code">{exitCode(exit)}</span>
    </span>
  )
}

export default function POIPopupCard({ poi, onClose, onTagClick, onStationClick, onPopupFocus, units, exitIndex }) {
  const [tagsExpanded, setTagsExpanded] = useState(false)
  const [infoExpanded, setInfoExpanded] = useState(false)

  // The POI's own coordinates, used to pick each station's closest exit.
  const poiCoord = poi.longitude != null && poi.latitude != null
    ? [poi.longitude, poi.latitude]
    : null

  const tags = Array.isArray(poi.tags) ? poi.tags : []
  const visibleTags = tagsExpanded ? tags : tags.slice(0, COLLAPSED_TAGS)
  const hiddenTagCount = tags.length - COLLAPSED_TAGS

  const infoRows = buildInfoRows(poi)
  const visibleRows = infoExpanded ? infoRows : infoRows.slice(0, COLLAPSED_INFO_ROWS)
  const hiddenRowCount = infoRows.length - COLLAPSED_INFO_ROWS

  const categoryLabel = POI_CATEGORIES[poi.category]?.label

  return (
    <div className="poi-popup" onMouseDown={onPopupFocus}>
      <div className="poi-popup-header">
        <CategoryIcon category={poi.category} />
        <div className="poi-popup-title">
          <div className="poi-popup-name">{poi.name}</div>
          {categoryLabel && <div className="poi-popup-category">{categoryLabel}</div>}
        </div>
        <span className="poi-popup-close" onClick={onClose} role="button" aria-label="Close">
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </span>
      </div>

      {tags.length > 0 && (
        <div className="poi-popup-tags">
          {visibleTags.map(t => {
            const color = POI_CATEGORIES[t]?.color || POI_CATEGORIES[poi.category]?.color || '#999'
            return (
              <button key={t} className="poi-popup-tag" onClick={() => onTagClick?.(t)}>
                <span className="poi-popup-tag-dot" style={{ background: color }} />
                <span className="poi-popup-tag-text">{t}</span>
              </button>
            )
          })}
          {hiddenTagCount > 0 && (
            <button
              className="poi-popup-expander"
              onClick={() => setTagsExpanded(v => !v)}
              aria-expanded={tagsExpanded}
            >
              {tagsExpanded ? 'fewer tags' : `${hiddenTagCount} more tags`}
            </button>
          )}
        </div>
      )}

      {infoRows.length > 0 && (
        <div className="poi-popup-info">
          {visibleRows.map(row => (
            <div key={row.kind} className="poi-popup-info-row">
              <InfoIcon kind={row.kind} />
              {row.content}
            </div>
          ))}
          {hiddenRowCount > 0 && (
            <button
              className="poi-popup-expander"
              onClick={() => setInfoExpanded(v => !v)}
              aria-expanded={infoExpanded}
            >
              {infoExpanded ? 'less' : `${hiddenRowCount} more`}
            </button>
          )}
        </div>
      )}

      {Array.isArray(poi.stations) && poi.stations.length > 0 && (
        <div className="poi-popup-stations">
          <div className="poi-popup-stations-label">Stations within a 15 min walk</div>
          {poi.stations.map(s => {
            const exits = poiCoord ? exitIndex?.get(`${s.lines}-${s.stopCode}`) : null
            const best = exits?.length ? nearestExit(exits, poiCoord) : null
            return (
              <button
                key={`${s.lines}-${s.stopCode}`}
                className="poi-popup-station-row"
                onClick={() => onStationClick?.(s)}
                aria-label={`${s.name}, ${formatWalk(s.walkingMeters, s.walkingSeconds, units)}`}
              >
                <span className="poi-popup-station-left">
                  <StationPillBody lines={s.lines} stopCode={s.stopCode} name={s.name} className="inline" />
                  {best && <ExitBadge exit={best.exit} />}
                </span>
                <span className="poi-popup-station-dist">
                  {formatWalk(s.walkingMeters, s.walkingSeconds, units)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
