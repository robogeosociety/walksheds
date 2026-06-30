# Design system

Walksheds is a transit project, so the visual language is real transit cartography — the classic stuff: Vignelli/Beck-lineage diagrams, clean line-colored routes, station roundels and pills, restrained sans-serif type. When you add or change UI, default to that idiom and reuse the existing vocabulary rather than inventing new ornament.

## The Link palette

The two operating lines use Sound Transit's official colors. They are defined once in `src/constants.js` and reused everywhere.

| Token | Hex | Used for |
| --- | --- | --- |
| 1 Line green | `#38B030` | <span class="roundel roundel-1">1</span> Line 1 routes, roundels, the dark-mode walkshed accent |
| 2 Line blue | `#00A0E0` | <span class="roundel roundel-2">2</span> Line 2 routes, roundels, the light-mode walkshed accent |

```js
export const LINE_COLORS = {
  '1-line': { color: '#38B030', label: '1 Line' },
  '2-line': { color: '#00A0E0', label: '2 Line' },
}

export const WALKSHED_ACCENT_LIGHT = '#00A0E0'  // blue accent on light maps
export const WALKSHED_ACCENT_DARK  = '#38B030'  // green accent on dark maps
```

In the shared segment (Lynnwood down to International District), Line 1 is offset west and Line 2 east so the two routes read as distinct parallel lines rather than one overlapping stroke.

## Station vocabulary

The **roundel** is a filled circle carrying a line number. The **pill** combines one or two roundels with the two-digit stop code and the station name:

<span class="roundel roundel-1">1</span> <span class="roundel roundel-2">2</span> `50` — Westlake (both lines)

Pills are built as SVG at runtime in `src/stationIcons.js` (light and dark variants) and rendered through `src/StationPill.jsx`. The legend shows a worked example of the pill so the map's vocabulary is self-documenting.

Station codes are themselves meaningful — first digit is the line, last two are the stop, increasing south and east from Westlake (50). See [Station codes](station-codes.md) for the full system.

## Walkshed bands

The three isochrone bands share one accent color and lean on opacity to read as nested time rings — densest nearest the station:

| Band | Opacity (fill) |
| --- | --- |
| 5 min | 0.22 |
| 10 min | 0.15 |
| 15 min | 0.10 |

The accent flips by mode (blue on light, green on dark) so the bands stay legible against the base map. Render order is outside-in (`15, 10, 5`) so the inner bands paint on top.

## Iconography

All control icons are **inline SVG**, hand-drawn to a shared spec — there is no icon font and no sprite for the control bar. The conventions:

- `viewBox="0 0 16 16"`, rendered at `width="12" height="12"` for control buttons.
- `stroke="currentColor"` so the icon inherits the button's color (which carries the light/dark and hover states via CSS).
- `strokeWidth="1.5"` (or `2` for chevrons), `strokeLinecap="round"`, `strokeLinejoin="round"` for the smooth transit feel.
- `fill="none"` for outline glyphs; `fill="currentColor"` for solid marks.

The legend control bar is the canonical example — dark-mode sun/moon, a units toggle, a help question-circle, the open-book **codex link** (which opens this site), and a collapse chevron. The codex link is an `<a target="_blank">` rather than a scripted `window.open`, because anchors are what behave correctly on iOS Safari.

Station sprites (the per-station map markers) are a separate, generated asset set with a manifest; see [INV-013](invariants.md) and [INV-014](invariants.md).

## The no-emoji rule

!!! danger "INV-018 — no emoji, anywhere"
    No emoji in the UI, popups, labels, docs, this wiki, commit messages, or PR descriptions. They are not the house style. Use real iconography (inline SVG, the station sprite drawer) or plain typographic marks instead. This is enforced as a core invariant — see [Core invariants](invariants.md).

## Type and tone

Restrained sans-serif, sentence case, no shouting. Copy describes what something is or does without filler. The map should feel like a published transit diagram, not a web dashboard — which means whitespace, alignment to the line vocabulary, and as little chrome as the interaction allows.
