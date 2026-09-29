# Darkhand style guide

How the Darkhand theme and dashboard look, how they're built, and the Deluge
and ExtJS behaviour they work around. It's written so that someone (or an
agent) picking the project up can change it without re-learning what went
into it, or rebuild the same design from scratch.

The source of truth is the code; this guide explains it. Exact values below
are the ones in the files at the time of writing.

## Contents

1. [Architecture](#1-architecture)
2. [Design principles](#2-design-principles)
3. [Tokens](#3-tokens)
4. [Dashboard layout](#4-dashboard-layout)
5. [Components](#5-components)
6. [Behaviour and remembered state](#6-behaviour-and-remembered-state)
7. [ExtJS and Deluge gotchas](#7-extjs-and-deluge-gotchas)
8. [Installer and plugin gotchas](#8-installer-and-plugin-gotchas)
9. [Testing](#9-testing)
10. [Making changes](#10-making-changes)

---

## 1. Architecture

Deluge's Web UI is ExtJS 3. Two pieces change it:

| Piece | Files | What it does |
| --- | --- | --- |
| **Theme** | `theme/xtheme-darkhand.css`, `theme/darkhand/` | An ExtJS "xtheme" stylesheet, loaded by Deluge's own theme mechanism (`web.conf` → `theme: darkhand`). Restyles Deluge's standard layout. Works on its own. |
| **Dashboard plugin** | `plugin/` (script: `plugin/deluge_darkhand/data/darkhand.js`) | A Deluge plugin whose web script rearranges Deluge's components into the dashboard. Needs the theme. |
| **Dashboard styles** | `theme/darkhand/dashboard.css` | Imported by the theme, but every rule is scoped to `.dh-dashboard`, a class only the plugin puts on `<body>`. Without the plugin none of it applies. |
| **Fonts** | `theme/darkhand/fonts.css`, `theme/darkhand/fonts/` | Inter and JetBrains Mono, served by `deluge-web` (no external requests). |
| **Icons** | `theme/darkhand/icons.css` (generated), `tools/build-icons.py` | Lucide line icons as data URIs, replacing Deluge's PNGs. Don't edit `icons.css` by hand. |
| **Installer** | `darkhand.sh` | Installs the theme, and optionally the plugin; uninstalls both. |

Why a plugin: a stylesheet can only restyle. Deluge's ExtJS layout positions
panels in JavaScript, so moving them needs script. The plugin's script loads
before `deluge.ui.initialize()` runs, wraps it, and when Deluge creates its
`Ext.Viewport`, builds the dashboard from the same components instead. Every
component keeps its own behaviour; only the arrangement (and some sizing)
changes.

Body classes set by the plugin, used to scope styles:

- `dh-dashboard`: the plugin is active.
- `dh-details-bottom` / `dh-details-right`: where the details card is.
- `dh-stats-below` / `dh-stats-above`: where the stats and chart are.

Other classes the plugin adds: `dh-header-compact`, `dh-toolbar-compact`,
`dh-overview-side`, `dh-chart-off`, `dh-stats-compact`, `dh-cols-N`,
`dh-stat-warn`, `dh-hd-last`, `dh-pref-list`, `dh-about` (+ `dh-about-*`
parts).

---

## 2. Design principles

- **Dark, flat, low glare.** A near-black backdrop with slightly lighter
  cards. Contrast comes from surface steps and 1px outlines, not shadows or
  gradients.
- **Floating cards.** In the dashboard every region is a rounded card on the
  backdrop, separated by one consistent gap (16px) on all sides, including
  the window edges.
- **One accent.** Blue from the Deluge logo (`#4c90e8`, with `#094491` for
  gradients). Status colours (green, amber, red, purple) only for meaning:
  torrent states, stat icons, warnings.
- **Deluge's own components, rearranged.** Don't rebuild what Deluge
  provides. Restyle it, tag it with classes, and adjust sizes through Ext.
- **Nothing clipped, nothing wrapped by accident.** Labels, headers and
  values must fit; when space is tight the layout degrades deliberately
  (compact header, icon-only buttons, short headers, stacked stats, hidden
  chart), never by cutting text off.
- **Preferences persist per browser** (localStorage), and defaults are the
  sensible choice for a new user.
- **Theme-only must keep working.** Anything dashboard-specific lives under
  `.dh-dashboard` or in the plugin.

---

## 3. Tokens

### Colour (`:root` in `xtheme-darkhand.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--dh-bg-0` | `#0d1014` | Backdrop; gaps between cards |
| `--dh-bg-1` | `#14181e` | Card and panel surfaces, grids, windows |
| `--dh-bg-2` | `#1a1f27` | Headers, toolbars, menus |
| `--dh-bg-3` | `#222833` | Hover, inputs |
| `--dh-bg-4` | `#2b3240` | Pressed, strong hover |
| `--dh-row-alt` | `#171b22` | Alternate grid rows |
| `--dh-border` | `#262c37` | Card outlines, dividers, frames |
| `--dh-border-strong` | `#353d4b` | Handles, grips, input borders |
| `--dh-text` | `#d7dce4` | Body text |
| `--dh-text-strong` | `#f2f4f8` | Titles, values, selected items |
| `--dh-text-muted` | `#8a94a6` | Labels, secondary text, icons in SVGs |
| `--dh-text-faint` | `#5a6373` | Captions, axis labels, column headers |
| `--dh-accent` | `#4c90e8` | Accent: selection, links, primary buttons |
| `--dh-accent-2` | `#094491` | Dark end of the progress gradient |
| `--dh-accent-soft` | `rgba(76,144,232,.16)` | Selected rows, primary button fill |
| `--dh-accent-softer` | `rgba(76,144,232,.08)` | Hover tints |
| `--dh-good` | `#3ecf8e` | Download, healthy |
| `--dh-warn` | `#f5b84b` | Queued, warnings, "Folder not found" |
| `--dh-bad` | `#ff5f6d` | Errors |

Other fixed colours: upload / seeding blue `#5b9dff`; connections purple
`#b197fc`; icon default `#b4bccb`. Stat icon tints are the icon colour at
10–14% opacity. SVG data URIs can't use CSS variables, so they hard-code the
token's hex (`%238a94a6` for muted text, `%234c90e8` for the accent...). Keep
those in step when changing a token.

### Type

- UI font: `--dh-font` (bundled Inter, as `'Darkhand Inter'`), base size
  `--dh-font-size` 12px. Inter's `cv05` and `cv08` alternates tell l, I and 1
  apart in torrent names.
- Monospace: `--dh-mono` (bundled JetBrains Mono) for hashes, peer addresses
  and paths.
- Numbers: `font-variant-numeric: tabular-nums` so they line up. Not on names:
  Inter's tabular forms also widen hyphens.
- Scale used in the dashboard:

| Text | Size / weight | Colour |
| --- | --- | --- |
| Page title | 30px, 700, -0.02em | strong |
| Brand ("DELUGE") | 21px, 800, uppercase, 0.08em | strong |
| Stat value | 20px, 700, -0.01em | strong |
| Stat label | 12px | muted |
| Stat caption | 11.5px | faint |
| Column headers (torrent list) | 10.5px, 700, uppercase, 0.08em | faint |
| Nav section labels (States, Trackers...) | 10.5px, 700, uppercase, 0.1em | faint |
| Window title | 14px, 600 | strong |
| About caption | 12px, 600, uppercase, 0.08em | faint |

### Shape and spacing

| Token / constant | Value | Where |
| --- | --- | --- |
| `--dh-card-radius` | 18px | Dashboard cards and windows |
| `--dh-frame-radius` | 10px | Frames inside windows (lists, Preferences pages), containers of controls (the header switches) |
| `--dh-radius` | 8px | Buttons (toolbar, window footers), inputs, small elements |
| `--dh-bar-radius` | 6px | Progress bars, the collapsed details strip, badges, and anything inside a frame with 4px around it (switch segments, Preferences rows) |
| `GAP` (plugin) | 16px | Between cards and around the window edge |
| `SPLIT` (plugin) | 12px | Resize bar / collapsed strip thickness |

Radii follow that scale everywhere; nothing is fully rounded except circular
icons and legend dots. Something nested inside a rounded container with a
gap around it takes the container's radius minus the gap, so the curves run
parallel (switch segments: 10px − 4px = 6px).
| Nav width | 248px | `--dh-nav-width` and the plugin |
| Brand height | 88px | Top of the nav card |
| Header height | 92px | Page title row |

Cards have **no outer drop shadow**: `box-shadow: inset 0 0 0 1px
var(--dh-border)` only (see gotcha G21). Windows do have one (they float over
the page): `0 0 0 1px var(--dh-border), 0 24px 60px rgba(0,0,0,.55)`.

---

## 4. Dashboard layout

```
+----------+  breadcrumb / page title        Stats [Above|Below] Details [Right|Bottom]
|  brand   |  +---------------------------------------------------------+
|----------|  | toolbar (card header)                                   |
| filters  |  | torrent list                                            |
|  (nav)   |  +---------------------------------------------------------+
|          |  +---------------------------+ +---------------------------+
|          |  | stats card (6 sections)   | | transfer speed chart      |
|          |  +---------------------------+ +---------------------------+
|          |  ======================= resize bar =======================
|          |  +---------------------------------------------------------+
|          |  | details card (Status, Details, Files, Peers, Options)   |
+----------+  +---------------------------------------------------------+
 status bar (full width, below everything)
```

Ext structure built by `buildLayout()`:

- Shell (border layout, `bbar: deluge.statusbar` so the status bar spans the
  whole window).
  - West: nav panel (248px) = brand box (north, 88px) + Deluge's sidebar
    (center).
  - Center: main panel (border layout).
    - North: header box (92px).
    - Center: list column (border layout) = torrent card (center, toolbar as
      `tbar`) + overview box (stats and chart, north or south).
    - South (bottom mode): details card.
  - East (right mode): details card.

Spacing: every card is `GAP` from its neighbours and from the window edge.
Where a resize bar sits between two cards, the margin beside it is
`GAP - SPLIT`, so bar + margin = `GAP`. When the bottom card is closed its
strip keeps a full `GAP` above it (`cmargins`).

Defaults: details at the **bottom**, stats **below** the list, details card
**open**, Owner column **hidden**.

### Stats and chart placement (`fitOverview`)

- Stats card: 6 sections in one row when there's room, otherwise 3 per row
  (always 3 with the details on the right, whose width changes as the card
  opens and closes). A section needs about 160px stacked (icon above value)
  and 230px with the icon beside the text; below that the card switches to
  the compact stacked style (`dh-stats-compact`).
- Chart: beside the stats when the column is wide (`dh-overview-side`, the
  two cards equal width), below them otherwise, and hidden (`dh-chart-off`)
  when either would leave the torrent list shorter than 220px
  (`MIN_LIST_HEIGHT`: toolbar, headings and about four rows).
- The overview region is resized to fit its content after every change
  (`ResizeObserver`, `document.fonts.ready`), deferred so it isn't lost in a
  nested layout (G2).

### Details card sizing

- Bottom: 30% of the window height, clamped 250–600px; a dragged size is
  kept (clamped 140px – 60% of the height).
- Right: 25% of the window width, clamped 400–640px; a dragged size is kept
  (320–720px).

### Large and small windows

- Very wide: Name grows up to 1600px (`autoExpandMax`; Ext's default is
  1000px), then the spare width is shared among the other columns in
  proportion. The details Status tab spreads its four columns across the
  bottom card and stacks them in the right-hand card.
- Narrow: header switch labels hide (`dh-header-compact`); the labelled
  toolbar buttons become icon-only buttons (`dh-toolbar-compact`); the torrent list gives
  Name priority (next section).

---

## 5. Components

### Cards

`border-radius: var(--dh-card-radius)`, `background: var(--dh-bg-1)`,
`box-shadow: inset 0 0 0 1px var(--dh-border)`, `overflow: hidden`. The
layout containers behind cards paint `--dh-bg-0`, so the rounded corners sit
on the backdrop (not on a lighter panel colour showing in the corners).

### Navigation card

Brand at the top (logo with an accent glow, "DELUGE"), a button that opens
Deluge's About window (click, Enter or Space; hover tint, focus ring). Below
it Deluge's filter sidebar, restyled as navigation: section labels in faint
small caps; the selected filter with a faint gradient, a 4px accent bar on
the right (`inset -4px 0 0`) and bold strong text. Deluge's "Filters" title
bar is hidden.

### Page header

Breadcrumb ("Deluge / Torrents") and a large title that follows the selected
filters, with a count badge. On the right, two segmented switches (Stats,
Details) with 10px corners; the active segment is filled with the accent,
with 6px corners. When the title and switches
don't both fit, the switch labels hide (kept as tooltips) rather than the
title wrapping. The header lines up with the list card's edges (right padding
`GAP - SPLIT` in right mode).

### Toolbar

Deluge's toolbar becomes the torrent card's header: transparent, flat text
and icon buttons that tint on hover. The "Deluge" label is hidden (the brand
replaces it). Preferences, Connection Manager, Help and Logout are buttons
with a label and 8px corners, or 28px square icon buttons when the whole
toolbar doesn't fit (measured on every toolbar resize). Labels stay as tooltips.

### Torrent list

- Headers: 10.5px bold uppercase, faint; no cell dividers. Hovering the
  header row shows a 2×14px grab handle at each column edge (brighter on the
  hovered column; none on Name; the last column's on its own border).
- Rows: fixed 28px; every cell has a 20px line so text, state icons and
  progress bars share one centre line.
- Columns fit the card exactly at every width (see G4–G8):
  - Name auto-expands to fill (up to 1600px). Owner is hidden by default.
  - Columns whose header doesn't fit are widened just enough (the uppercase
    headers are wider than Deluge's defaults: "DOWN SPEED" needs ~90px vs 80).
  - When Name would get less than 240px (`NAME_MIN`), the speed headers
    become "↓ Speed" / "↑ Speed" (full name as tooltip) and the other columns
    shrink proportionally, never below 90% of their normal width
    (`SHRINK_TO`) or below their header or content minimum.
  - Progress never goes below its longest label ("Downloading 99.99%", or its
    translation) + 12px, measured in the actual font (~141px).
  - A column you resize by hand keeps your width (remembered); Name takes
    whatever is left.
  - None of this changes the widths Deluge saves in its column cookie.
- Progress bars: 20px, radius 6px, fill gradient `--dh-accent-2` →
  `--dh-accent`, label centred on the track (white over the fill, muted over
  the track).

### Stats card

One card, six sections (Download, Upload, Active torrents, Connections, DHT
nodes, Free space), separated by inset dividers. Each: a round icon with a
soft tint in its colour, a 12px label, a 20px value, an 11.5px caption.
Values come from Deluge's regular `web.update_ui` poll (no extra requests).
Free space shows "Folder not found" in amber (15px, same line height so the
card doesn't jump) with an "Open Preferences" link when Deluge reports -1.

### Transfer speed chart

Plain SVG, no library. Five-minute window, sampled from the same poll.
Download green, upload `#5b9dff`; 2px round-capped lines with a fading area
fill (30% / 18% opacity to 0). Monotone cubic smoothing (Fritsch–Carlson) so
lines never dip below zero. Axis: a "nice" maximum (1, 1.5, 2, 3, 4, 5, 6, 8
× 10ⁿ in binary units, at least 16 KiB/s), dashed grid at top, middle and
zero, labels in a 70px gutter. Lines are clipped to the plot and break at
gaps of more than 10 seconds between updates (G27).

### Details card, resize bar and collapsed strip

The same in both positions:

- Bar between list and card: 12px, transparent; a 2px line along its middle
  on hover; a grip in the middle (6×48px, `--dh-border-strong`, accent on
  hover) that closes the card. Tooltip "Drag to resize. Double-click to
  close."
- Closed: a 12px rounded strip (`--dh-bg-1`, 1px outline, lighter on hover)
  with a chevron pointing towards where the card opens; clicking anywhere on
  it opens the card in place.
- Uses Ext's `collapseMode: 'mini'` (G11). With no torrent selected, the card
  fades its contents into its own surface (G18).

### Windows and dialogs

Every Ext window in the dashboard is a card: card surface and radius, no
separate title or body frame, outer outline + shadow (G20).

- Title bar: 14px 600 title, its icon lined up at 18px, a Lucide × close
  button (24px, rounded hover).
- Body: 12px side padding; framed inner panels get 10px corners, drawn clip-
  safe (G19); windows that frame their whole body (Login, Remove...) keep
  that frame.
- Add Torrents: two framed sections 10px apart (`.dh-add-section`), the
  torrent list with its File / Url / Remove bar at the bottom, and the Files /
  Options tabs at the top of the second. The Options section and the window
  get 12px more height so the rounded corners don't clip the form's last row.
  The torrent list is an inset list (`.dh-inset-list`: styled like
  Preferences' page list, rows 6px apart), and the Files tab matches it: rows 6px in, no grid lines, rounded
  hover/selected bars, Filename stretched to fill (`stretchFileNames`), Lucide
  file icons, and CSS-drawn Download checkboxes like the Options tab's.
- Footer: buttons with 8px corners; the last one (the main action: OK, Connect, Add,
  Move, Remove Torrent) accent-filled. Not in message boxes (G17).
- Message boxes: Lucide circle-help / info (accent), triangle-alert (warn),
  circle-x (bad) instead of Ext's bitmaps.
- Fixed-size windows are grown by 24×36px for the roomier chrome (G16).
- About: logo (64px, glowing) as its hero, small uppercase caption title,
  version large, details muted, copyright faint, accent link, 300×412px.
- Connection Manager: an inset list like Edit Trackers', columns sized to
  their text (`fitListColumns`), window
  widens up to 640px for long hosts; a lone host is pre-selected once its
  status arrives.
- Edit Trackers: an inset list, headers lined up with the rows; the window
  sizes to the longest tracker URL (`fitListColumns`), from its default width
  up to 800px (or the viewport less 48px) and back, centred. Longer URLs end
  in an ellipsis, with the full URL as a tooltip.
- Preferences: the page list is inset 6px in its frame, rows with 6px
  corners, the current page filled with the soft accent. The Plugins page's
  list is an inset list, its Enabled checkboxes CSS-drawn like the Files
  tab's; Find More gets the Lucide search icon.

### Status bar

Full width along the bottom of the window, `--dh-bg-0` with a top border,
below all cards (each card ends `GAP` above it).

### Icons

Lucide line icons, generated into `icons.css` by `tools/build-icons.py`
(colours per purpose: toolbar actions default, torrent states green / blue /
amber / red, priorities...). Every rule is `html body ... !important` to beat
`deluge.css`, which sets several icons with `!important` itself. Dashboard-
only icons (stat icons, chevrons, close ×, message box icons) are inline data
URIs in `dashboard.css`.

---

## 6. Behaviour and remembered state

| Key | Storage | Meaning |
| --- | --- | --- |
| `darkhand.detailsMode` | localStorage | `bottom` (default) or `right` |
| `darkhand.statsPosition` | localStorage | `below` (default) or `above` |
| `darkhand.detailsOpen` | localStorage | `0` if the details card was closed; open otherwise |
| `darkhand.detailsSize` | localStorage | `{bottom: height, right: width}` dragged sizes |
| `darkhand.sizedColumns` | localStorage | Column ids you resized by hand |
| `darkhand.ownerHidden` | localStorage | Owner was hidden once; after that your choice sticks |
| `darkhand.reloadedAt` | sessionStorage | Reload-loop guard (see below) |
| `ys-torrentGrid` | cookie (Deluge's) | Column widths / order / sort; the plugin never saves its display-only extras into it |

- The Stats and Details switches reload the page (the layout is built once).
- Enabling the plugin into a running page reloads into the dashboard (after
  Preferences closes, if it's open). If the page reloaded for the dashboard
  less than a minute ago and still didn't get it, it asks instead: never a
  reload loop. Disabling asks before reloading.
- The details card only opens and closes when you do it (no auto-open on
  selection: it would fight the remembered state).

---

## 7. ExtJS and Deluge gotchas

Each learned the hard way. Symptom → cause → what the code does.

**Layout**

- **G1. Region options ignored.** `BorderLayout` reads a region's options
  (`region`, `margins`, `split`, `collapseMode`...) from `initialConfig`, not
  the component. Setting properties on an existing Deluge component does
  nothing → `configure()` sets both.
- **G2. Nested `doLayout()` is ignored.** Laying out while Ext is already
  laying out the same container silently does nothing → re-layout with
  `Ext.defer(..., 1)` after the current pass.
- **G3. `view.layout` is called through a stored reference.** Some resizes
  (opening the right-hand card) reach the grid's layout without going through
  `view.layout`, so a wrapper there misses them → hook `view.onLayout`, which
  ends every layout.
- **G11. Default collapse floats the panel.** Clicking a collapsed region's
  bar (not its expand button) slides the panel out *over* the layout, leaving
  the collapsed bar underneath → `collapseMode: 'mini'`, where a click on the
  strip expands in place.
- **G12. Split bars and strips are sized from the DOM.** Ext reads their
  `offsetWidth`/`offsetHeight`, so CSS can widen them, but Ext's own CSS sets
  the collapsed strip `width: 5px !important` → override with `!important`
  and shrink the neighbouring margin (`GAP - SPLIT`) in the plugin.
- **G10. Split bar events don't fire.** The region's `onSplitMove` handler
  returns `false`, which stops the bar's `moved` event (and any later
  `beforeapply` listener) → the region stores the size in `lastSplitSize` and
  calls the panel's `saveState()`, so the plugin wraps `saveState` to
  remember the size.

**Torrent grid**

- **G4. Width changes don't redraw rows.** `setColumnWidth(i, w, true)`
  updates headers and cells but doesn't re-render rows, and Deluge's progress
  renderer bakes the column width into each bar (in px) → when the Progress
  width changes, `view.refresh()` (inside the busy guard: refresh calls
  layout).
- **G5. "User resized" freezes the grid.** Dragging any column edge sets
  `view.userResized`, which stops Name auto-expanding for the rest of the
  session, so the columns stop following the window → clear it after the
  drag; your width is kept via `darkhand.sizedColumns`.
- **G6. Display widths leak into the cookie.** `GridPanel.getState` saves the
  current widths, including any stretch the plugin added → wrap `getState` to
  subtract the extras.
- **G7. `autoExpandMax` defaults to 1000px.** Name stops growing there on big
  screens → 1600px, and share any remaining width.
- **G8. Changing a header drops the sort arrow.** `setColumnHeader`
  re-renders the header row → call `view.updateHeaderSortState()` after.
  Also: only change headers when the text differs, or every layout re-renders
  them; remember the full header's width while it's shown to decide without
  re-rendering.
- **G9. Hiding a column saves state 100ms later.** A reload in that window
  loses it → call `grid.saveState()` straight away.
- **G22. Progress label off-centre.** Ext pads the label 5px on the left, and
  Deluge's rendered bars (`x-progress-renderered`) size the label to the
  bar's *outer* width, border included → padding 0 and `margin-left: -1px`
  on rendered bars only (a real `Ext.ProgressBar` sizes it correctly).
- **G23. Text and bars on different lines.** Grid cells are top-aligned and
  text lines are shorter than the 20px bars → `line-height: 20px` on every
  cell. Rows are a fixed 28px, so don't add vertical padding.
- **G30. Column resize zone.** Ext starts a resize from the last few pixels
  of a header cell *or* the first 5px of the next one, but the hovered
  cell's menu button (⌄) covers its own edge → grab handles sit just past the
  edge; the last visible column (followed by hidden ones, so CSS can't find
  it) is tagged `dh-hd-last` and its handle sits on its border.
- **G33.** `view.getCell()` throws when the grid has no rows yet: check
  `view.hasRows()`.

**Windows**

- **G13. The footer lives in the bottom frame cell.** In framed Ext windows
  the button bar is inside `.x-window-bc`; giving that cell a height cuts the
  buttons off.
- **G14. `!important` in Ext and Deluge CSS.** `.x-btn td { padding: 0
  !important }`, `.x-window-tl .x-panel-icon { padding-left: 20px
  !important }`, `.x-deluge-main-panel { background-image: ... !important }`
  → match with `!important` where needed, and comment why.
- **G15. Inline styles.** Deluge styles the About window's labels inline →
  the plugin tags each part with a class; CSS uses `!important`.
- **G16. Fixed window sizes.** Deluge gives most windows a fixed size; a
  roomier title, footer and padding squash their contents → grow every
  window with a numeric size by 24×36px in `Ext.Window.prototype.
  initComponent` (installed before Deluge creates its windows). Windows
  created before the plugin loads (Remove, Move Download Folder, Copy Magnet)
  aren't rendered until first shown, so their instance sizes can still be
  changed.
- **G17. Message boxes keep hidden buttons.** `Ext.Msg` renders OK, Yes, No
  and Cancel and hides the unused ones, so "last button" isn't the main
  action → no accent button in `.x-window-dlg`.
- **G18. Disabled panels go black.** Ext masks a disabled panel with 50%
  black, far darker than the cards → masks inside panels and windows use
  `--dh-bg-1` at 60%. The page-wide modal mask stays dark.
- **G19. Frames lose their right/bottom edge.** Framed panels end exactly on
  the edges of containers that clip them; at fractional display scalings the
  clip can round inward and cut the border's last pixel (and some browsers
  lay the panels out a pixel or two past the window body) → keep the 1px
  border for Ext's sizing but transparent; draw the frame with `::after` on
  the panel's wrapper (`.x-panel-bwrap:has(> .x-panel-body...)`), `inset:
  1px`, `z-index: 2`. Not an `outline` (it paints under positioned children,
  e.g. the Preferences pages) and not in the body (it would scroll with the
  content). With the frame 1px in, the lines inside (toolbars, grid headers,
  tab strips) would run 1px past it, so the wrapper is clipped to the
  frame's outer edge: `clip-path: var(--dh-frame-clip)`, i.e. `inset(1px
  round <frame radius - 1px>)`. Windows laid out in regions get `overflow:
  visible` on the body.
  A window that frames its whole body skips that frame when a framed panel
  inside already frames the contents (one frame, never two), and toolbars
  inside frames are transparent with a divider rather than a darker strip.
- **G37. `:has()` can't be nested.** `:has(... :not(:has(...)))` is invalid,
  and an invalid selector drops the *whole rule*, taking every other
  selector in it along. Write such conditions as sibling `:has()` /
  `:not(:has())` checks, and keep experimental selectors in rules of their
  own.
- **G20. Inset shadows on windows vanish.** The window's own frame cells
  paint over an inset outline → windows use an outer `0 0 0 1px` ring.
- **G24. ListView columns are fractions.** Change `columns[i].width`
  (fraction of the list width), then `list.setHdWidths()` and
  `list.refresh()`. Refresh clears the selection: restore it.
- **G25. Measure the right element.** A ListView cell's `<dt>` still has
  Ext's 11px Tahoma; the text is in its `<em>` with the theme font. Measure
  the `<em>`.
- **G32.** `Ext.Element.toggleClass` takes no on/off argument in Ext 3; use
  `addClass`/`removeClass`.

**Rendering**

- **G21. Card shadows become square bands.** Ext's region containers clip at
  their edges, so a card's outer drop shadow shows only in the 16px gaps, as
  a darker band with square ends → no outer shadow on cards.
- **G26. Late web fonts.** Inter arrives after first layout and changes text
  widths → refit on `document.fonts.ready` and from `ResizeObserver`s.
- **G27. Background tabs pause updates.** The poll stops while a tab is in
  the background or the computer sleeps; a sample kept from before the chart
  window can then be minutes old and draw far outside the card → clip lines
  to the plot and break them at gaps > 10s.
- **G34. Theme load order.** Deluge before 2.2 loads the theme *before*
  `deluge.css`. Selectors that compete with it are prefixed `html` (or `html
  body`) so they win either way.
- **G35. Sprites.** Ext's gray-theme sprites are dark-on-light; the theme
  recolours them with `--dh-sprite-filter` or replaces them with vector
  chevrons and Lucide icons.

**Deluge**

- **G28. Free space -1.** `core.get_free_space` returns -1 when the daemon
  can't find the download folder (missing, or not reachable by the user
  `deluged` runs as). Deluge's status bar shows "Error"; the stats card
  explains it.
- **G29. Plugins can load after startup.** Deluge adds a newly enabled
  plugin's script to the running page (after installing, or when ticked in
  Preferences → Plugins). The layout can only be built at startup → reload,
  guarded against loops.
- **G31.** Deluge's toolbar "Deluge" item (`#tbar-deluge-text`) opens About;
  it's hidden in the dashboard (`td:has(> #tbar-deluge-text)` and the
  separator after it), so the brand does it instead.
- **G36.** The Connection Manager's Connect button needs the host's status
  (it enables per status), which arrives after the host list; select a lone
  host then, and only once per load so deselecting sticks.

---

## 8. Installer and plugin gotchas

- `deluge-web` rewrites `web.conf` when it exits, so the theme setting must
  be edited while it's stopped (the installer stops systemd units, or asks
  you to stop an unmanaged process).
- The daemon caches the table of contents of an egg it has seen by path;
  replacing the file at the same path makes it read stale offsets → every
  install uses a fresh egg name (`Darkhand-<version>+<timestamp>-py3.egg`).
- The daemon only writes `core.conf` on a clean shutdown → after enabling or
  disabling over RPC (as `localclient`, from the daemon's `auth` file), the
  installer edits `enabled_plugins` in `core.conf` too.
- A web plugin needs a core part to appear under Preferences → Plugins; the
  core part does nothing.
- Deluge configs are two concatenated JSON objects (a version header, then
  the config); parse both and write both back, in place, to keep ownership.
- `install` and `uninstall` need root; `status` doesn't.
- "Theme only" over an earlier dashboard install removes the plugin, so
  what's installed matches the choice.

---

## 9. Testing

Tests are ad-hoc Playwright scripts against a real Deluge (daemon + web in a
virtualenv, a few small torrents). Things that proved useful:

- **Measure, don't eyeball.** Compare element rects (gaps between cards,
  header vs card edges, column total vs grid width, label centre vs track
  centre), sample screenshot pixels for colours, and check `scrollWidth >
  clientWidth` for clipping.
- **Screenshots at several scalings.** Borders and 1px details differ at
  `deviceScaleFactor` 1, 1.25, 1.5 and 2 (G19).
- **Window sizes.** 1024, 1280, 1440, 1920, 2560 and 3840 wide; both details
  positions; both stats positions; card open and closed.
- **Simulated traffic.** Intercept `web.update_ui` with `page.route` and set
  `download_rate` / `upload_rate` for the chart; say so wherever such
  screenshots are published.
- **Time.** `page.clock` to fast-forward (e.g. a 10-minute gap for G27).
- **Interactions.** Drag real split bars and column edges with the mouse
  (Ext's drag zones need real events), then reload to check what's
  remembered.
- **Every window.** Open each Ext window and message box and check nothing
  overflows its body, buttons sit inside, and it fits on screen.
- **Theme-only.** Disable the plugin and check the standard layout still
  looks right.
- **The daemon.** Deluge validates host names when adding connections (use
  an IP), and headless test containers may lose the daemon on restart: check
  it's running before blaming the code.

---

## 10. Making changes

- **Colours:** change the `--dh-*` tokens in `xtheme-darkhand.css`; update
  hard-coded hex values in SVG data URIs and in `tools/build-icons.py`, then
  rebuild `icons.css`.
- **Dashboard-only styles** go in `dashboard.css`, scoped to `.dh-dashboard`.
- **Sizes shared between CSS and the plugin** (`SPLIT`, nav width, brand and
  header heights) must be changed in both places.
- **Deluge components:** restyle and rearrange; don't replace. Wrap Deluge or
  Ext methods (call the original, then adjust), keep failures from breaking
  Deluge (`try`/`catch` around layout polish), and never store display-only
  values in Deluge's own saved state.
- **Comments** describe the code as it is and why, not its history.
- **After a change:** run the checks in section 9 for what you touched,
  refresh the README screenshots if the look changed, and keep the theme-only
  layout working.
