# Test scripts

Playwright checks against a running Deluge web UI. They open and close
windows but change nothing, so use a throwaway test server: a daemon and
deluge-web in a virtualenv, with the theme installed (`darkhand.sh`) and a
few torrents (8 or so small ones, some seeding, some downloading and
queued).

## Setup

```sh
npm install playwright        # or point NODE_PATH at a global install
npx playwright install chromium
pip install pillow            # for compare.py
```

Run from the repository root. `DELUGE_URL` (default
`http://localhost:8112/`) and `DELUGE_PASSWORD` (default `deluge`) pick the
server.

## Scripts

| Script | What it does | Time |
| --- | --- | --- |
| `screenshots.js <tag> [theme]` | Screenshots of the dashboard (bottom and right details, 1440 and 1024 wide), its details tabs, context menu and 13 windows into `test-output/<tag>/`. With `theme`, the plain theme (switch the Darkhand plugin off first). | ~15s |
| `cutoff.js [wide]` | Lists text that's cut off anywhere: the dashboard, its details tabs and menu, and every window. `wide` adds 0.3px letter spacing to catch what wider font rendering would cut off. Run both. | ~20s each |
| `compare.py <base> <base-again> <new>` | Compares two screenshot sets pixel by pixel. Take the baseline twice: pixels that differ between those two runs (speeds, timers) are ignored. | seconds |
| `harness.js` | Shared by the others: logs in once per page, opens and closes windows, and waits for conditions (rows loaded, window shown) rather than fixed times. | |

## A typical check

```sh
node tools/test/screenshots.js before && node tools/test/screenshots.js before2
# ...make the change, reinstall the theme...
node tools/test/screenshots.js after
python3 tools/test/compare.py before before2 after
node tools/test/cutoff.js; node tools/test/cutoff.js wide
```

A pure refactor should compare as `same` everywhere. For a visual change,
check that only the expected screenshots differ, and look at them.

`cutoff.js` always lists two expected kinds of entry: progress labels
"clipped by x-progress-text" (the bar's white copy is clipped to its fill
on purpose), and details-tab columns past the edge of the narrow right-hand
card (they scroll).

## Adding a window

Add it to `WINDOWS` in `harness.js`: `open` runs in the page, and `ready`
(optional) is true once anything it loads from the daemon has arrived. Then
list it in `screenshots.js` and `cutoff.js`.
