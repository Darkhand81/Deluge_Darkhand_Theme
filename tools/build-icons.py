#!/usr/bin/env python3
"""Generate theme/darkhand/icons.css from Lucide SVG icons.

Replaces Deluge's PNG icons with inline SVG line icons coloured per purpose
(toolbar actions, torrent states, priorities...). Needs a copy of the
lucide-static package, e.g.:

    npm pack lucide-static && tar xzf lucide-static-*.tgz
    python3 tools/build-icons.py package/icons

Lucide is ISC licensed: https://lucide.dev/license
"""

import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'theme' / 'darkhand' / 'icons.css'

# Colours, matching the --dh-* tokens in xtheme-darkhand.css
ICON = '#b4bccb'
ACCENT = '#4c90e8'
GREEN = '#3ecf8e'
BLUE = '#5b9dff'
AMBER = '#f5b84b'
GRAY = '#8a94a6'
RED = '#ff7a84'
PURPLE = '#b197fc'
BAD = '#ff5f6d'
WHITE = '#ffffff'

# (comment, [selectors], lucide icon, colour[, stroke width])
ICONS = [
    ('Toolbar and context menu actions', None, None, None),
    ('', ['.icon-add', '.x-deluge-add-window-icon'], 'plus', ICON),
    ('', ['.icon-add-url', '.x-deluge-add-url-window-icon'], 'link', ICON),
    ('', ['.icon-create', '.x-deluge-add-file'], 'file-plus', ICON),
    ('', ['.icon-remove', '.x-deluge-remove-window-icon'], 'trash-2', RED),
    ('', ['.icon-pause'], 'pause', ICON),
    ('', ['.icon-resume'], 'play', ICON),
    ('', ['.icon-up'], 'arrow-up', ICON),
    ('', ['.icon-down'], 'arrow-down', ICON),
    ('', ['.icon-top'], 'arrow-up-to-line', ICON),
    ('', ['.icon-bottom'], 'arrow-down-to-line', ICON),
    ('', ['.icon-queue'], 'list-ordered', ICON),
    ('', ['.x-deluge-preferences'], 'settings', ICON),
    ('', ['.icon-options'], 'settings-2', ICON),
    (
        '',
        ['.x-deluge-connection-manager', '.x-deluge-connect-window-icon'],
        'plug',
        ICON,
    ),
    ('', ['.icon-help'], 'circle-help', ICON),
    ('', ['.icon-logout'], 'log-out', ICON),
    ('', ['.icon-magnet', '.icon-magnet-add', '.icon-magnet-copy'], 'magnet', ICON),
    ('', ['.icon-update-tracker'], 'refresh-cw', ICON),
    (
        '',
        ['.icon-edit', '.icon-edit-trackers', '.x-deluge-edit-trackers'],
        'pencil',
        ICON,
    ),
    ('', ['.icon-recheck'], 'search-check', ICON),
    ('', ['.icon-move', '.x-deluge-move-storage'], 'folder-input', ICON),
    ('', ['.icon-upload-slots'], 'upload', ICON),
    ('', ['.icon-expand-all'], 'chevrons-up-down', ICON),
    ('', ['.icon-home'], 'house', ICON),
    ('', ['.icon-back'], 'arrow-left', ICON),
    ('', ['.icon-forward'], 'arrow-right', ICON),
    ('', ['.x-deluge-login-window-icon'], 'lock', ICON),
    ('', ['.x-deluge-install-plugin'], 'blocks', ICON),
    ('', ['.x-deluge-find-more'], 'search', ICON),
    ('', ['.icon-ok'], 'circle-check', GREEN),
    ('', ['.icon-error', '.x-not-connected'], 'circle-alert', RED),
    ('File priorities', None, None, None),
    ('', ['.icon-do-not-download', '.x-no-download'], 'circle-slash', GRAY),
    ('', ['.icon-low', '.x-low-download'], 'chevron-down', BLUE),
    ('', ['.icon-normal', '.x-normal-download'], 'equal', ICON),
    ('', ['.icon-high', '.x-high-download'], 'chevrons-up', AMBER),
    ('Status bar', None, None, None),
    ('', ['.x-deluge-connections'], 'network', ICON),
    ('', ['.x-deluge-traffic'], 'arrow-up-down', ICON),
    ('', ['.x-deluge-dht'], 'waypoints', ICON),
    ('', ['.x-deluge-freespace'], 'hard-drive', ICON),
    ('Torrent states (sidebar filters, torrent names, speeds)', None, None, None),
    ('', ['.x-deluge-all'], 'layers', ACCENT),
    ('', ['.x-deluge-active'], 'activity', ACCENT),
    ('', ['.x-deluge-downloading', '.x-deluge-peer'], 'circle-arrow-down', GREEN),
    ('', ['.x-deluge-seeding', '.x-deluge-seed'], 'circle-arrow-up', BLUE),
    ('', ['.x-deluge-queued'], 'clock', AMBER),
    ('', ['.x-deluge-paused'], 'circle-pause', GRAY),
    ('', ['.x-deluge-error'], 'triangle-alert', RED),
    ('', ['.x-deluge-checking'], 'refresh-ccw', PURPLE),
    ('', ['.x-deluge-moving'], 'folder-input', PURPLE),
    ('Dashboard stat cards (Darkhand plugin)', None, None, None),
    ('', ['.dh-stat-download .dh-stat-icon'], 'arrow-down', GREEN),
    ('', ['.dh-stat-upload .dh-stat-icon'], 'arrow-up', BLUE),
    ('', ['.dh-stat-active .dh-stat-icon'], 'activity', ACCENT),
    ('', ['.dh-stat-connections .dh-stat-icon'], 'users', PURPLE),
    ('', ['.dh-stat-dht .dh-stat-icon'], 'waypoints', ICON),
    ('', ['.dh-stat-space .dh-stat-icon'], 'hard-drive', AMBER),
    ('Files tree', None, None, None),
    ('', ['.x-tree-node-leaf .x-deluge-file', '.x-treegrid .x-tree-node-leaf .x-tree-node-icon'], 'file', GRAY),
    ('', ['.x-tree-node-collapsed .x-tree-node-icon'], 'folder', AMBER),
    ('', ['.x-tree-node-expanded .x-tree-node-icon'], 'folder-open', AMBER),
    ('Dashboard windows and details card (Darkhand plugin)', None, None, None),
    ('', ['.dh-dashboard .x-window .x-tool-close'], 'x', GRAY),
    ('', ['.dh-dashboard .x-window-dlg .ext-mb-question'], 'circle-help', ACCENT),
    ('', ['.dh-dashboard .x-window-dlg .ext-mb-info'], 'info', ACCENT),
    ('', ['.dh-dashboard .x-window-dlg .ext-mb-warning'], 'triangle-alert', AMBER),
    ('', ['.dh-dashboard .x-window-dlg .ext-mb-error'], 'circle-x', BAD),
    ('', ['.dh-dashboard .dh-inset .x-grid3-check-col-on::after'], 'check', WHITE, 3.5),
    ('', ['.dh-details-right .x-layout-cmini-east .x-layout-mini'], 'chevron-left', GRAY, 2.5),
    ('', ['.dh-details-bottom .x-layout-cmini-south .x-layout-mini'], 'chevron-up', GRAY, 2.5),
    ('Menus: a grid column\'s sort and columns items, and ticked check items', None, None, None),
    ('', ['.xg-hmenu-sort-asc .x-menu-item-icon'], 'arrow-down-a-z', ICON),
    ('', ['.xg-hmenu-sort-desc .x-menu-item-icon'], 'arrow-down-z-a', ICON),
    ('', ['.x-cols-icon'], 'columns-3', ICON),
    ('', ['.x-menu-item-checked .x-menu-check-item:not(.x-menu-group-item) .x-menu-item-icon'], 'check', WHITE, 3.5),
]

# Classes the plugin puts on <body> itself
BODY_CLASSES = ('.dh-dashboard', '.dh-details-right', '.dh-details-bottom')

HEADER = """\
/*
 * Darkhand icons - generated by tools/build-icons.py, do not edit by hand.
 *
 * Line icons from Lucide (https://lucide.dev), ISC License:
 * Copyright (c) Lucide Icons and Contributors; portions (c) Cole Bemis
 * (Feather). Permission to use, copy, modify, and/or distribute this
 * software for any purpose with or without fee is hereby granted, provided
 * that the above copyright notice and this permission notice appear in all
 * copies.
 *
 * Every rule is "html body ... !important" so it beats deluge.css, which
 * sets several of these icons with !important itself.
 */
"""


def data_uri(icon_dir, name, colour, stroke=None):
    svg = (icon_dir / f'{name}.svg').read_text()
    if stroke is not None:
        svg = svg.replace('stroke-width="2"', f'stroke-width="{stroke}"', 1)
    svg = re.sub(r'<!--.*?-->', '', svg, flags=re.S)
    svg = re.sub(r'\s+class="[^"]*"', '', svg)
    svg = re.sub(r'width="24"', 'width="16"', svg, count=1)
    svg = re.sub(r'height="24"', 'height="16"', svg, count=1)
    svg = svg.replace('currentColor', colour)
    svg = re.sub(r'\s+', ' ', svg).replace('> <', '><').strip()
    return 'data:image/svg+xml,' + quote(svg, safe=" =/:'\"-.,")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    icon_dir = Path(sys.argv[1])
    out = [HEADER]
    for comment, selectors, name, colour, *stroke in ICONS:
        if selectors is None:
            out.append(f'\n/* {comment} */\n')
            continue
        sel = ',\n'.join(
            ('html body' if s.startswith(BODY_CLASSES) else 'html body ') + s for s in selectors
        )
        uri = data_uri(icon_dir, name, colour, *stroke).replace('"', "'")
        out.append(f'{sel} {{\n    background-image: url("{uri}") !important;\n}}\n')
    # Deluge leaves x-not-connected on the status text once connected and
    # relies on x-connected to blank the icon; keep that working.
    out.append(
        '\nhtml body .x-not-connected.x-connected {\n'
        '    background-image: none !important;\n}\n'
    )
    OUT.write_text(''.join(out))
    print(f'wrote {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
