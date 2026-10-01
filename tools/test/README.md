# Test scripts

Playwright checks against a running Deluge web UI. They open and close
windows but change nothing, so use a throwaway test server, which
`test-server.sh` makes.

## The test server

```sh
tools/test/test-server.sh setup        # once: about 20s
tools/test/test-server.sh install      # after changing the theme or plugin
tools/test/test-server.sh plugin off   # the plain theme (then "on" again)
tools/test/test-server.sh start | stop | restart | status
```

Run it as root (in a container, or with `sudo` for every command): the
theme installer it uses, `darkhand.sh`, needs root, and the server's files
then belong to root.

`setup` makes `test-server/` in the checkout (ignored by git): a
virtualenv with Deluge 2.2 and libtorrent, its own config, and eight small
sample torrents (4 seeding, 3 downloading, 1 queued; two are folders of
files). It installs the theme and dashboard plugin from this checkout with
`darkhand.sh`, and starts the daemon and web UI at
http://127.0.0.1:8112/ (password `deluge`). The web UI connects to the
daemon on its own and skips the first-login password prompt. Running
`setup` again is safe: it reuses what's there.

`DH_TEST_DIR`, `DH_WEB_PORT` and `DH_DAEMON_PORT` put it elsewhere, for
example beside a real Deluge. Nothing outside its directory is touched, and
`stop` stops only its own processes.

Needs python3 (3.9 to 3.12) with venv, and curl.

## The checks

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
| `screenshots.js <tag> [theme]` | Screenshots of the dashboard (bottom and right details, 1440 and 1024 wide), its details tabs, context menu and 23 windows and dialogs into `test-output/<tag>/`. With `theme`, the plain theme (switch the Darkhand plugin off first). | ~15s |
| `cutoff.js [wide]` | Lists text that's cut off anywhere: the dashboard, its details tabs and menu, and every window. `wide` adds 0.3px letter spacing to catch what wider font rendering would cut off. Run both. | ~20s each |
| `readme-screenshots.js` | The README's dashboard screenshots, at 1920×1080, into `screenshots/`: the three layouts, the torrent menu, Add Torrents, Preferences, the Connection Manager and the speed chart over 30 days. Transfer activity and the long-range history are simulated (the test server has no peers) and the page's clock run on five minutes, so the speed chart is full. `DH_TORRENT` picks the torrent Add Torrents shows (default: the test server's `Sintel.2010.4K`). | ~1 min |
| `compare.py <base> <base-again> <new>` | Compares two screenshot sets pixel by pixel. Take the baseline twice: pixels that differ between those two runs (speeds, timers) are ignored. | seconds |
| `test-server.sh`, `test_server.py` | The test server (above); the Python helper runs in its virtualenv. | |
| `harness.js` | Shared by the others: logs in once per page, opens and closes windows, and waits for conditions (rows loaded, window shown) rather than fixed times. | |

## A typical check

```sh
node tools/test/screenshots.js before && node tools/test/screenshots.js before2
# ...make the change...
tools/test/test-server.sh install
node tools/test/screenshots.js after
python3 tools/test/compare.py before before2 after
node tools/test/cutoff.js; node tools/test/cutoff.js wide
```

For the plain theme, run `test-server.sh plugin off` first and pass
`theme` to `screenshots.js`. A pure refactor should compare as `same`
everywhere. For a visual change,
check that only the expected screenshots differ, and look at them.

`cutoff.js` always lists two expected kinds of entry: progress labels
"clipped by x-progress-text" (the bar's white copy is clipped to its fill
on purpose), and details-tab columns past the edge of the narrow right-hand
card (they scroll).

## Adding a window

Add it to `WINDOWS` in `harness.js`: `open` runs in the page, and `ready`
(optional) is true once anything it loads from the daemon has arrived. A
dialog opened from another window (Edit Connection, Edit Tracker) opens that
window in `open`, and itself in `then`, which runs once `ready` is true. Then
list it in `screenshots.js` and `cutoff.js`.
