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

Every token is defined once, in `:root` in `xtheme-darkhand.css`, so the
plain theme and the dashboard share them; `dashboard.css` only adds its
layout tokens (`--dh-frame-clip`, `--dh-inset`, `--dh-nav-width`). Write a
colour, radius or transition as its token, never as a literal. A tint of a
colour is `color-mix(in srgb, var(--dh-...) N%, transparent)`, so it follows
the colour if that changes.

### Colour

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
| `--dh-accent-soft` | accent 16% | Selected rows, primary button fill |
| `--dh-accent-softer` | accent 8% | Hover tints |
| `--dh-accent-ring` | accent 45% | The ring of an accent-tinted button |
| `--dh-accent-glow` | accent 45% | The glow round the logo (brand, About) |
| `--dh-on-accent` | `#fff` | Text and marks on the accent |
| `--dh-good` | `#3ecf8e` | Download, healthy |
| `--dh-warn` | `#f5b84b` | Queued, warnings, "Folder not found" |
| `--dh-bad` | `#ff5f6d` | Errors |
| `--dh-bad-surface` | `#3a1c22` | Error tooltips |
| `--dh-upload` | `#5b9dff` | Upload / seeding |
| `--dh-purple` | `#b197fc` | Connections |
| `--dh-icon` | `#b4bccb` | Icon default |
| `--dh-border-hover` | `#414a5a` | A button's ring, a scrollbar thumb, on hover |

Stat icon tints are their colour at 10–14%. Icons are SVG data URIs, which
can't use CSS variables: they're all generated by `tools/build-icons.py`,
whose colour constants match these tokens (keep them in step), never pasted
into a stylesheet.

### Type

- UI font: `--dh-font` (bundled Inter, as `'Darkhand Inter'`), base size
  `--dh-font-size` 12px. Inter's `cv05` and `cv08` alternates tell l, I and 1
  apart in torrent names.
- Monospace: `--dh-mono` (bundled JetBrains Mono) for hashes, peer addresses
  and paths.
- Numbers: `font-variant-numeric: tabular-nums` so they line up. Not on names:
  Inter's tabular forms also widen hyphens.
- Type scale: every font size is one of seven tokens (`:root` in
  `xtheme-darkhand.css`); never a literal size.

| Token | Size | Used for |
| --- | --- | --- |
| `--dh-text-caption` | 10.5px | Uppercase captions: torrent list headers, nav section labels, panel headers, chart axis |
| `--dh-text-small` | 11.5px | Stat captions, monospace hashes and paths, dialog forms, column headers in windows and the plain theme, About copyright |
| `--dh-text-base` | 12px | Body text (`--dh-font-size`), stat labels, chart legend, switches |
| `--dh-text-body` | 13px | Nav filters, breadcrumb, chart title, About text, plain theme window titles |
| `--dh-text-title` | 14px | Dashboard window titles, the torrent count, the Free space warning |
| `--dh-text-value` | 20px | Stat values, the brand, the About title |
| `--dh-text-display` | 30px | Page title |

Weights and spacing by role: page title 700, -0.02em; brand 800,
uppercase, 0.08em; stat value 700, -0.01em; uppercase captions 700 (600 in
the plain theme), 0.08em; window titles 600. Colours: titles and values
strong, labels muted, captions faint.

### Shape and spacing

| Token / constant | Value | Where |
| --- | --- | --- |
| `--dh-card-radius` | 18px | Dashboard cards and windows |
| `--dh-frame-radius` | 10px | Frames inside windows (lists, Preferences pages), containers of controls (the header switches), the plain theme's panels |
| `--dh-radius` | 8px | Buttons (toolbar, window footers), menus, tooltips, the plain theme's windows and tabs (7px: less their 1px edge) |
| `--dh-bar-radius` | 6px | Progress bars, the collapsed details strip, badges, and anything inside a frame with 4px around it (switch segments, Preferences rows) |
| `--dh-small-radius` | 4px | Inputs, checkboxes, menu items |
| `--dh-ease` | 0.12s ease | Every hover / state transition |
| `--dh-inset` | 6px | How far the rows of lists in windows sit in from their frame (and apart), and the gap between form rows; the plugin reads it |
| `--dh-window-pad` | 12px | A window's side margin, how far a form or text dialog's contents sit inside its frame on every side, and the room above and below footer buttons; the plugin reads it |
| `--dh-label-gap` | 10px | Between a form's longest label and its fields (the plugin fits the label column to it) |
| `--dh-frame-clip` | `inset(1px round 9px)` | Clips a framed panel to its frame's outer edge (G19) |
| `GAP` (plugin) | 16px | Between cards and around the window edge |
| `SPLIT` (plugin) | 12px | Resize bar / collapsed strip thickness |
| Nav width | 248px | `--dh-nav-width` and the plugin |
| Brand height | 88px | Top of the nav card |
| Header height | 92px | Page title row |

Spacing in windows comes from those three tokens, one value per role
(picked from screenshots of each option):

| Role | Value |
| --- | --- |
| Window side margin (edge to frame) | `--dh-window-pad` 12px |
| Form and text dialogs: contents to frame, every side | `--dh-window-pad` 12px |
| Footer: frame to buttons, buttons to window edge | `--dh-window-pad` 12px |
| Form rows: one to the next | `--dh-inset` 6px |
| List rows: in from the frame, and apart | `--dh-inset` 6px |
| Longest label to its field | `--dh-label-gap` 10px |

Write new window spacing with these tokens rather than numbers; the plugin
reads them from CSS, so changing a token changes both.

Radii follow that scale everywhere; nothing is fully rounded except circular
icons and legend dots. Something nested inside a rounded container with a
gap around it takes the container's radius minus the gap, so the curves run
parallel (switch segments: 10px − 4px = 6px).

Cards have **no outer drop shadow**: `box-shadow: inset 0 0 0 1px
var(--dh-border)` only (see gotcha G21). Things that float over the page do,
from two tokens: windows `--dh-shadow-window` (`0 24px 60px`, 60% black;
in the dashboard with a `--dh-border` ring outside), and menus, drop-down
lists, tooltips and the loading box `--dh-shadow-pop` (`0 12px 30px`, 50%).
Uppercase captions (nav section labels, column headers, the About title)
share a letter-spacing of 0.08em.

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

Its tabs follow the dashboard's style (`#torrentDetails` is the whole tab
panel, so a rule for one tab needs that tab's own class):

- Status: its four columns spread across the bottom card and stack in the
  right-hand one.
- Details (`.dh-details-tab`): labels and values in a two-column grid, the
  labels' column as wide as the longest.
- Files and Peers (`.dh-card-grid`, from the same `afterRender` hook as the
  inset lists): the torrent list's look, sharing its rules (uppercase caption
  headers, no column dividers, a line under each row). The widest text column
  (Filename, Address; never a progress bar) takes what the others leave
  (`fitWidths`): the others shrink to their content, then to their header,
  their text ending in an ellipsis with the full text as a tooltip; Peers'
  speed headers become "↓ Speed" / "↑ Speed" when even that's too wide.
  Progress bars are redrawn at their column's new width. No peers shows "No
  peers connected".
- Options (`.dh-options`): the fieldsets are frames (`--dh-frame-radius`, the
  title inside as an uppercase caption), side by side at the same height,
  each as wide as its content, wrapping when the card is narrow and stacked
  in the right-hand card; labels on one line. Apply is the main action,
  styled like a window's.

### Windows and dialogs

Every Ext window in the dashboard is a card: card surface and radius, no
separate title or body frame, outer outline + shadow (G20).

- Title bar: 14px 600 title, its icon lined up at 18px, a Lucide × close
  button (24px, rounded hover).
- Body: `--dh-window-pad` side margin; framed inner panels get 10px
  corners, drawn clip-safe (G19); windows that frame their whole body
  (Login, Remove...) keep that frame.
- Form and text dialogs (Edit Tracker, Add Connection, Move Download Folder,
  Remove Torrent, plugins' form dialogs...): `fitFormWindow` sets their
  contents `--dh-window-pad` inside the frame on every side (the window
  widening by what the sides gain; not beside a right-aligned label column's
  row), fits the
  label column to the longest label plus `--dh-label-gap`, and fits the
  height to the contents. Form rows are `--dh-inset` apart in every window.
- Login: laid out like the other form dialogs (`styleLoginWindow`): Deluge
  centres a short field under a 120px right-aligned label column; the label
  goes on the left and the field fills the rest of the row, not growing as
  you type.
- After changing a form's label column, delete its fields' `anchorSpec`
  before `doLayout()`: Ext's anchor functions remember the width they last
  sized for and return nothing for the same width, so the fields would keep
  their old size.
- Preferences: 36px taller than other windows grow (its Interface page needs
  it with the row spacing), and taller still when a page (a plugin's) would
  scroll, up to the screen (`fitPreferences`).
- Lists, grids and tree grids in windows: see Inset lists, below.
- Add Torrents: two framed sections 10px apart (`.dh-add-section`), the
  torrent list with its File / Url / Remove bar at the bottom, and the Files /
  Options tabs at the top of the second, their strip `--dh-inset` in from the
  frame. The Options section and the window get 24px more height so the
  rounded corners don't clip the form's last row (12px, and 12 for its six
  checkbox rows at `--dh-inset` apart); the form is padded 15px at
  the sides (set before render, G39), like the Preferences pages.
- Footer: `--dh-window-pad` above and below the buttons; buttons with 8px corners; the last one (the main action: OK, Connect, Add,
  Move, Remove Torrent) accent-filled. Not in message boxes (G17).
- Message boxes: Lucide circle-help / info (accent), triangle-alert (warn),
  circle-x (bad) instead of Ext's bitmaps.
- Fixed-size windows are grown by 24×36px for the roomier chrome (G16).
- About: logo (64px, glowing) as its hero, small uppercase caption title,
  version large, details muted, copyright faint, accent link, 300×412px.
- Connection Manager: the window widens up to 640px to fit its hosts
  (`fitListColumns` with a `maxWidth`); a lone host is pre-selected once its
  status arrives.
- Edit Trackers: the window sizes to the longest tracker URL, from its
  default width up to 800px (or the viewport less 48px) and back, centred.
- Preferences: the page list is a menu (`.dh-pref-list`): rows `--dh-inset`
  in from its frame with 6px corners, the current page filled with the soft
  accent. Find More (Plugins page) gets the Lucide search icon.

### Inset lists

Every list, grid and tree grid in a window, whichever dialog or plugin it
belongs to, gets one design, the Preferences menu's: rows `--dh-inset` in
from the frame, rounded (`--dh-bar-radius`), no stripes, grid lines or
selection bar; the hovered / selected row filled (`--dh-bg-3` /
`--dh-accent-soft`); column headers moved in with the rows; checkboxes drawn
like the form's (a rounded box, accent-filled and ticked when on).

Nothing is per dialog. `insetWindowLists` hooks the `afterRender` of Ext's
three list components (`hookInset`), so plugins' pages (and plugins added
later) are included; a component in a window gets `.dh-inset` (the shared
rules: checkboxes, header divider) and its kind:

| Component | Class | Fitting the width |
| --- | --- | --- |
| `Ext.list.ListView` | `.dh-inset-list` | `fitListInPlace`: columns fitted to their text, the widest stretching; text still too long ends in an ellipsis, with a tooltip. `fitListColumns` with a `maxWidth` also sizes the window (Connection Manager, Edit Trackers: `dhSizesWindow`) |
| `Ext.grid.GridPanel` (and `EditorGridPanel`) | `.dh-inset-grid` | Scroller padded `--dh-inset` (Ext sizes it less its padding, G39); the view's `scrollOffset` twice the inset larger, so its auto-expanding column leaves room |
| `Ext.ux.tree.TreeGrid` | `.dh-inset-tree` | `stretchTreeColumn`: the widest column takes what the others leave, less the inset; row colour on the cells, which take the rounding |

Preferences' page list is excluded (it's the menu, above). Lists outside
windows (the sidebar, the torrent list, the details tabs) aren't touched. A
plugin drawing a list some other way (its own HTML, a plain tree) keeps the
theme's colours and fonts, without the inset.

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
- **G38. A component's classes arrive after `onRender`.** `addClass()`
  before rendering queues the class (`this.cls`); Ext puts it on the element
  after `onRender`, so a hook there doesn't see it → hook `afterRender`.
- **G40. Ext only looks 10 elements up for a grid row.** A grid finds the
  row a click is in with `findParent(rowSelector, 10)`, so a click on
  anything nested deeper selects nothing and opens no context menu. The
  filled progress bar's own label is one level too deep; with the bar
  stacked above the "back" label (so it doesn't peek out), it was what got
  clicked → `pointer-events: none` on `.x-progress-bar`. Don't add wrapper
  elements inside grid cells, and give anything stacked on top of a cell's
  content `pointer-events: none`.
- **G39. Padding and Ext's sizes.** Where Ext sizes an element with
  `setSize` / `setWidth` (a grid's scroller, a panel body it lays out), it
  subtracts the element's CSS padding, so padding there is safe. Where the
  size comes from a config (a form's `bodyStyle` padding, fixed column
  widths), CSS padding adds to it and overflows → set it in the config
  before render, or leave room in the component (a grid view's
  `scrollOffset`).
- **G41. Deluge's form fields don't know their labels.** Deluge replaces
  `FormLayout.renderItem` (`Ext.ux.layout.FormLayoutFix`) and never sets a
  field's `label`, so Ext's anchor layout doesn't take the label's width off
  an anchored field: `anchor: '100%'` beside a label runs that far past the
  form (Edit Tracker, Add Tracker). Deluge's narrower anchors (Add
  Connection's 75% and 40%) are sized for this, so the plugin sets `label`
  only for full-width anchors. Small form windows also keep Deluge's padding,
  fixed heights and label columns (sized for its font); the plugin lays them
  out by the spacing tokens instead (`fitFormWindow`, `fitFormLabels`: see
  Windows and dialogs), and widens any window whose title doesn't fit on
  one line (`fitWindowTitle`: the status
  bar's Other... limits are 210px, or 180 once Deluge resizes one without a
  unit).
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

Tests are Playwright scripts against a real Deluge (daemon + web in a
virtualenv, a few small torrents), which `tools/test/test-server.sh setup`
builds. `tools/test/` has the standing checks (see its README): screenshots of the dashboard, its menu and every window,
compared pixel by pixel before and after a change, and an audit for cut-off
text at normal and wider font rendering. Run both for any CSS change; a
refactor should compare identical. Things that proved useful beyond them:

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
  an IP), and headless test containers may lose the daemon on restart:
  `test-server.sh status` before blaming the code, `start` to bring it back.
  Deluge 2.2 needs pyOpenSSL before 25 and setuptools before 81 (the setup
  pins them).

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
