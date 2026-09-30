#!/bin/bash
# A throwaway Deluge for the test scripts: daemon and web UI in their own
# virtualenv and config, eight sample torrents, and the theme and dashboard
# plugin installed from this checkout. Nothing outside its directory is
# touched.
#
#   tools/test/test-server.sh setup        make it, install, start
#   tools/test/test-server.sh start|stop|restart
#   tools/test/test-server.sh install      reinstall the theme and plugin
#                                          from this checkout (after a change)
#   tools/test/test-server.sh plugin on|off
#   tools/test/test-server.sh status
#
# DH_TEST_DIR (default test-server/ in the checkout), DH_WEB_PORT (8112) and
# DH_DAEMON_PORT (58846) change where it lives and listens. The web UI's
# password is "deluge". Needs python3 (3.9 to 3.12) with venv, and curl.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
DIR=${DH_TEST_DIR:-$REPO/test-server}
WEB_PORT=${DH_WEB_PORT:-8112}
DAEMON_PORT=${DH_DAEMON_PORT:-58846}
VENV=$DIR/venv
CONFIG=$DIR/config
PY=$VENV/bin/python
HELPER="$PY -W ignore::DeprecationWarning $REPO/tools/test/test_server.py"

say() { printf '%s\n' "$*"; }
die() { printf 'test-server: %s\n' "$*" >&2; exit 1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
web_up() { [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/")" = 200 ]; }

wait_for() { # <what> <test...>
    local what=$1; shift
    for _ in $(seq 1 60); do "$@" && return 0; sleep 0.5; done
    die "$what didn't start (see $CONFIG/$what.log)"
}

# The pid in a pidfile, if that process is still running
running() {
    local f=$DIR/$1.pid
    [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null
}

start_daemon() {
    running deluged && port_open "$DAEMON_PORT" && return
    nohup "$VENV/bin/deluged" -d -c "$CONFIG" -p "$DAEMON_PORT" -L warning -l "$CONFIG/deluged.log" \
        >/dev/null 2>&1 &
    echo $! > "$DIR/deluged.pid"
    wait_for deluged port_open "$DAEMON_PORT"
}

start_web() {
    running deluge-web && web_up && return
    nohup "$VENV/bin/deluge-web" -d -c "$CONFIG" -p "$WEB_PORT" -L warning -l "$CONFIG/deluge-web.log" \
        >/dev/null 2>&1 &
    echo $! > "$DIR/deluge-web.pid"
    wait_for deluge-web web_up
}

stop_one() {
    local f=$DIR/$1.pid
    if running "$1"; then
        kill "$(cat "$f")"
        for _ in $(seq 1 20); do kill -0 "$(cat "$f")" 2>/dev/null || break; sleep 0.25; done
    fi
    rm -f "$f"
}

start() {
    [ -x "$PY" ] || die "not set up yet: run $0 setup"
    start_daemon
    start_web
    say "running: web UI http://127.0.0.1:$WEB_PORT/ (password deluge), daemon port $DAEMON_PORT"
}

stop() {
    stop_one deluge-web
    stop_one deluged
    say "stopped"
}

install_theme() {
    # the web UI reads the theme and plugin when it starts
    stop_one deluge-web
    # (its output only if it fails: it can't enable the plugin with the web
    # UI stopped, which setup does itself afterwards)
    local out
    out=$(bash "$REPO/darkhand.sh" install --dashboard -y --no-restart -p "$PY" -c "$CONFIG" 2>&1) ||
        { printf '%s\n' "$out" >&2; die "installing the theme failed"; }
    say "installed the theme and plugin from $REPO"
    start_web
}

setup() {
    mkdir -p "$DIR" "$CONFIG"
    if [ ! -x "$PY" ]; then
        say "creating the virtualenv (Deluge 2.2, libtorrent)..."
        python3 -m venv "$VENV"
        # Pinned for Deluge 2.2: pyOpenSSL 25 dropped X509Req, which the
        # daemon makes its certificate with; setuptools before 81 still has
        # pkg_resources, which it loads plugins with
        "$VENV/bin/pip" install -q --disable-pip-version-check deluge==2.2.0 libtorrent \
            'pyOpenSSL==24.2.1' 'cryptography<44' 'setuptools<81'
    fi
    $HELPER make-data "$DIR"
    start_daemon
    # The web UI writes its config and host list when it first starts;
    # then point it at the daemon so it connects on its own
    if [ ! -f "$CONFIG/hostlist.conf" ]; then
        start_web
        stop_one deluge-web
    fi
    $HELPER default-daemon "$CONFIG" "$DAEMON_PORT"
    install_theme
    $HELPER add-torrents "$CONFIG" "$DIR" "$DAEMON_PORT"
    $HELPER plugin on "$CONFIG" "$DAEMON_PORT"
    start
}

case "${1:-}" in
    setup) setup ;;
    start) start ;;
    stop) stop ;;
    restart) stop; start ;;
    install) install_theme ;;
    plugin)
        [[ "${2:-}" =~ ^(on|off)$ ]] || die "usage: $0 plugin on|off"
        start_daemon
        $HELPER plugin "$2" "$CONFIG" "$DAEMON_PORT"
        ;;
    status)
        running deluged && port_open "$DAEMON_PORT" && $HELPER status "$CONFIG" "$DAEMON_PORT" || say "daemon: stopped"
        if running deluge-web && web_up; then say "web UI: http://127.0.0.1:$WEB_PORT/"; else say "web UI: stopped"; fi
        ;;
    *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
