#!/usr/bin/env bash
#
# Darkhand theme installer for the Deluge 2.x Web UI (Linux).
#
#   sudo ./darkhand.sh install     copy the theme in and make it the active theme
#   sudo ./darkhand.sh uninstall   remove the theme and restore the previous one
#        ./darkhand.sh status      show what is installed where
#
# Run "./darkhand.sh --help" for all options.

set -euo pipefail

THEME_NAME="darkhand"
THEME_FILE="xtheme-${THEME_NAME}.css"
BASE_THEME_FILE="xtheme-gray.css" # imported by the Darkhand stylesheet
DEFAULT_THEME="gray"              # Deluge's own default
PREV_FILE=".darkhand-previous-theme"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_CSS="${SCRIPT_DIR}/theme/${THEME_FILE}"
ASSET_DIR="$THEME_NAME" # fonts and icons, installed as themes/darkhand
SRC_ASSETS="${SCRIPT_DIR}/theme/${ASSET_DIR}"
PLUGIN_NAME="Darkhand" # dashboard layout plugin, built from plugin/
SRC_PLUGIN="${SCRIPT_DIR}/plugin"

ACTION=""
WEB_DIRS=()
CONFIG_DIRS=()
DAEMON_DIRS=() # config dirs of the daemon (core.conf), where plugins live
DELUGE_PY=""   # a Python interpreter that can import deluge
PYTHONS=()
ACTIVATE=1
PLUGIN="" # 1 theme + dashboard plugin, 0 theme only; empty: ask
RESTART=1
ASSUME_YES=0

STOPPED_UNITS=()
PLUGIN_ENABLED=0
REMOVE_PLUGIN=0 # theme only chosen over an installed dashboard plugin

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

if [[ -t 1 ]]; then
    C_RESET=$'\e[0m' C_BOLD=$'\e[1m' C_DIM=$'\e[2m'
    C_BLUE=$'\e[34m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_RED=$'\e[31m'
else
    C_RESET="" C_BOLD="" C_DIM="" C_BLUE="" C_GREEN="" C_YELLOW="" C_RED=""
fi

info() { printf '%s==>%s %s\n' "${C_BLUE}${C_BOLD}" "${C_RESET}" "$*"; }
ok() { printf '  %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn() { printf '  %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die() {
    printf '%serror:%s %s\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2
    exit 1
}

usage() {
    cat <<EOF
${C_BOLD}Darkhand${C_RESET} - dark theme for the Deluge 2.x Web UI

${C_BOLD}Usage:${C_RESET} $(basename "$0") <install|uninstall|status> [options]

${C_BOLD}Commands:${C_RESET}
  install      Install the theme, and optionally the Darkhand dashboard layout
               plugin (asks which). The theme is set as the Web UI theme
               either way, and is the fallback if the plugin is disabled. (root)
  uninstall    Remove the theme and plugin, and restore the previous theme (root)
  status       Show detected Deluge installs and the active theme

${C_BOLD}Options:${C_RESET}
  -w, --web-dir DIR      Deluge web UI directory (.../site-packages/deluge/ui/web).
                         Auto-detected when omitted. May be given more than once.
  -c, --config-dir DIR   Deluge config directory containing web.conf.
                         Auto-detected when omitted. May be given more than once.
  -p, --python PATH      Python interpreter Deluge is installed under
                         (used for auto-detection of the web directory).
      --no-activate      Only copy the theme file; do not touch web.conf.
                         On Deluge 2.2+ you can then pick "Darkhand" under
                         Preferences > Interface > Theme.
      --no-restart       Do not stop/start deluge-web systemd services.
      --dashboard        Install the theme and the dashboard layout plugin
                         without asking (the default with --yes).
      --theme-only       Install just the theme, without asking; removes the
                         dashboard plugin if an earlier install added it.
                         (--no-plugin is an alias.)
  -y, --yes              Do not ask for confirmation.
  -h, --help             Show this help.

${C_BOLD}Examples:${C_RESET}
  sudo ./$(basename "$0") install
  sudo ./$(basename "$0") install --theme-only -y
  sudo ./$(basename "$0") install -c /var/lib/deluged/config
  sudo ./$(basename "$0") install -w ~/.local/lib/python3.12/site-packages/deluge/ui/web
  sudo ./$(basename "$0") uninstall
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

parse_args() {
    while (($#)); do
        case "$1" in
            install | uninstall | status)
                [[ -z "$ACTION" ]] || die "only one command may be given"
                ACTION="$1"
                ;;
            -w | --web-dir)
                [[ $# -ge 2 ]] || die "$1 needs a directory"
                WEB_DIRS+=("${2%/}")
                shift
                ;;
            --web-dir=*) WEB_DIRS+=("${1#*=}") ;;
            -c | --config-dir)
                [[ $# -ge 2 ]] || die "$1 needs a directory"
                CONFIG_DIRS+=("${2%/}")
                shift
                ;;
            --config-dir=*) CONFIG_DIRS+=("${1#*=}") ;;
            -p | --python)
                [[ $# -ge 2 ]] || die "$1 needs a path"
                PYTHONS+=("$2")
                shift
                ;;
            --python=*) PYTHONS+=("${1#*=}") ;;
            --no-activate) ACTIVATE=0 ;;
            --no-restart) RESTART=0 ;;
            --dashboard | --with-plugin) PLUGIN=1 ;;
            --theme-only | --no-plugin) PLUGIN=0 ;;
            -y | --yes) ASSUME_YES=1 ;;
            -h | --help)
                usage
                exit 0
                ;;
            *) die "unknown argument: $1 (see --help)" ;;
        esac
        shift
    done
    [[ -n "$ACTION" ]] || {
        usage
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

# Prints the unique entries of "$@", preserving order.
uniq_list() {
    local seen="" item
    for item in "$@"; do
        [[ -n "$item" ]] || continue
        case $'\n'"$seen"$'\n' in *$'\n'"$item"$'\n'*) continue ;; esac
        seen+="$item"$'\n'
        printf '%s\n' "$item"
    done
}

# Python interpreter named in the shebang of an executable on PATH.
shebang_python() {
    local exe line
    exe="$(command -v "$1" 2>/dev/null)" || return 0
    [[ -f "$exe" ]] || return 0
    IFS= read -r line <"$exe" || true
    [[ "$line" == '#!'* ]] || return 0
    line="${line#\#!}"
    # "#!/usr/bin/env python3" -> python3
    read -r -a parts <<<"$line"
    if [[ "${parts[0]##*/}" == "env" ]]; then
        printf '%s\n' "${parts[1]:-}"
    else
        printf '%s\n' "${parts[0]}"
    fi
}

# PIDs of running deluge-web processes: "deluge-web ..." or
# "python deluge-web ..." / "python -m deluge.ui.web ...".
deluge_web_pids() {
    local d
    local -a args
    for d in /proc/[0-9]*; do
        mapfile -d '' -t args 2>/dev/null <"$d/cmdline" || continue
        ((${#args[@]})) || continue
        if [[ "${args[0]##*/}" == deluge-web || "${args[1]:-}" == */deluge-web ||
            "${args[1]:-}" == deluge-web || "${args[2]:-}" == deluge.ui.web ]]; then
            printf '%s\n' "${d#/proc/}"
        fi
    done
}

# PIDs of running deluged (daemon) processes.
deluged_pids() {
    local d
    local -a args
    for d in /proc/[0-9]*; do
        mapfile -d '' -t args 2>/dev/null <"$d/cmdline" || continue
        ((${#args[@]})) || continue
        if [[ "${args[0]##*/}" == deluged || "${args[1]:-}" == */deluged ||
            "${args[1]:-}" == deluged ]]; then
            printf '%s\n' "${d#/proc/}"
        fi
    done
}

# Config directory passed to a running deluge-web or deluged via -c/--config.
pid_config_dir() {
    local -a args
    local i
    mapfile -d '' -t args 2>/dev/null <"/proc/$1/cmdline" || return 0
    for ((i = 0; i < ${#args[@]}; i++)); do
        case "${args[i]}" in
            -c | --config) printf '%s\n' "${args[i + 1]:-}" ;;
            --config=*) printf '%s\n' "${args[i]#*=}" ;;
            -c?*) printf '%s\n' "${args[i]#-c}" ;;
        esac
    done
}

# Python interpreters that might have Deluge installed, most likely first.
candidate_pythons() {
    local -a pys=("${PYTHONS[@]}")
    local pid
    # The interpreter of a running deluge-web is the most reliable hint.
    local -a args
    for pid in $(deluge_web_pids); do
        mapfile -d '' -t args 2>/dev/null <"/proc/$pid/cmdline" || continue
        case "${args[0]##*/}" in
            python*) pys+=("${args[0]}") ;;
            deluge-web) [[ -f "${args[0]}" ]] && pys+=("$(shebang_python "${args[0]}")") ;;
        esac
    done
    pys+=("$(shebang_python deluge-web)" "$(shebang_python deluged)" python3 python)
    uniq_list "${pys[@]}"
}

# Prints the deluge/ui/web directory of the Deluge installed for Python $1.
python_web_dir() {
    "$1" - 2>/dev/null <<'PY' || true
import importlib.util, os
spec = importlib.util.find_spec("deluge")
if spec and spec.submodule_search_locations:
    print(os.path.join(list(spec.submodule_search_locations)[0], "ui", "web"))
PY
}

detect_deluge_python() {
    [[ -n "$DELUGE_PY" ]] && return 0
    local py
    while IFS= read -r py; do
        command -v "$py" >/dev/null 2>&1 || continue
        if [[ -n "$(python_web_dir "$py")" ]]; then
            DELUGE_PY="$py"
            return 0
        fi
    done < <(candidate_pythons)
    return 1
}

detect_web_dirs() {
    ((${#WEB_DIRS[@]})) && return 0

    local py dir
    local -a found=() uniq_pys=()
    mapfile -t uniq_pys < <(candidate_pythons)
    for py in "${uniq_pys[@]}"; do
        command -v "$py" >/dev/null 2>&1 || continue
        dir="$(python_web_dir "$py")"
        if [[ -n "$dir" && -d "$dir/themes/css" ]]; then
            found+=("$dir")
            [[ -n "$DELUGE_PY" ]] || DELUGE_PY="$py"
        fi
    done

    # Common system locations, in case the interpreter probe missed them.
    local g
    shopt -s nullglob
    for g in /usr/lib/python3*/{site,dist}-packages/deluge/ui/web \
        /usr/lib64/python3*/site-packages/deluge/ui/web \
        /usr/local/lib/python3*/{site,dist}-packages/deluge/ui/web \
        /usr/lib/python3/dist-packages/deluge/ui/web \
        /opt/*/lib/python3*/site-packages/deluge/ui/web \
        /lsiopy/lib/python3*/site-packages/deluge/ui/web; do
        [[ -d "$g/themes/css" ]] && found+=("$(cd "$g" && pwd -P)")
    done
    shopt -u nullglob

    local d
    mapfile -t WEB_DIRS < <(
        for d in "${found[@]}"; do (cd "$d" && pwd -P); done | awk '!seen[$0]++'
    )
}

detect_config_dirs() {
    local -a cands=()
    local pid dir home c

    if ((${#CONFIG_DIRS[@]})); then
        # Given with --config-dir: use those for the daemon's plugins too.
        mapfile -t DAEMON_DIRS < <(
            for c in "${CONFIG_DIRS[@]}"; do
                [[ -f "$c/core.conf" ]] && (cd "$c" && pwd -P)
            done 2>/dev/null | awk '!seen[$0]++'
        )
        return 0
    fi

    # Config dirs of running deluge-web/deluged processes are the most
    # reliable hint.
    for pid in $(deluge_web_pids) $(deluged_pids); do
        dir="$(pid_config_dir "$pid")"
        if [[ -n "$dir" ]]; then
            [[ "$dir" == /* ]] ||
                dir="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)/$dir"
            cands+=("$dir")
            # deluge-web and deluged change into their config directory
            cands+=("$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)")
        else
            home="$( (tr '\0' '\n' 2>/dev/null <"/proc/$pid/environ" || true) |
                sed -n 's/^HOME=//p')"
            [[ -n "$home" ]] && cands+=("$home/.config/deluge")
        fi
    done

    cands+=("${HOME:-/root}/.config/deluge")
    if [[ -n "${SUDO_USER:-}" ]]; then
        home="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
        [[ -n "$home" ]] && cands+=("$home/.config/deluge")
    fi
    home="$(getent passwd deluge 2>/dev/null | cut -d: -f6)" && [[ -n "$home" ]] &&
        cands+=("$home/.config/deluge" "$home/config")
    home="$(getent passwd debian-deluged 2>/dev/null | cut -d: -f6)" && [[ -n "$home" ]] &&
        cands+=("$home/config" "$home/.config/deluge")
    cands+=(/var/lib/deluged/config /var/lib/deluge/.config/deluge
        /srv/deluge/.config/deluge /config)
    shopt -s nullglob
    cands+=(/home/*/.config/deluge /root/.config/deluge)
    shopt -u nullglob

    mapfile -t CONFIG_DIRS < <(
        for c in "${cands[@]}"; do
            [[ -f "$c/web.conf" ]] && (cd "$c" && pwd -P)
        done 2>/dev/null | awk '!seen[$0]++'
    )
    mapfile -t DAEMON_DIRS < <(
        for c in "${cands[@]}"; do
            [[ -f "$c/core.conf" ]] && (cd "$c" && pwd -P)
        done 2>/dev/null | awk '!seen[$0]++'
    )
}

# ---------------------------------------------------------------------------
# web.conf handling
# ---------------------------------------------------------------------------

find_python() {
    local py
    for py in "${PYTHONS[@]}" python3 python; do
        command -v "$py" >/dev/null 2>&1 && {
            printf '%s\n' "$py"
            return 0
        }
    done
    die "python3 is required to edit web.conf (or use --no-activate)"
}

# conf_theme <web.conf>             -> prints the current theme
# conf_theme <web.conf> <new-theme> -> sets the theme, prints the old one
conf_theme() {
    "$(find_python)" - "$@" <<'PY'
import json, sys

path = sys.argv[1]
new = sys.argv[2] if len(sys.argv) > 2 else None

with open(path, encoding="utf8") as f:
    data = f.read()

# Deluge configs are two concatenated JSON objects: a version header and the
# config itself. Very old files may only contain the config object.
decoder = json.JSONDecoder()
objs, idx = [], 0
while idx < len(data):
    while idx < len(data) and data[idx].isspace():
        idx += 1
    if idx >= len(data):
        break
    obj, idx = decoder.raw_decode(data, idx)
    objs.append(obj)

if not objs:
    sys.exit("empty config")
conf = objs[-1]
old = conf.get("theme", "gray")
print(old)

if new is not None and new != old:
    conf["theme"] = new
    out = "".join(
        json.dumps(o, indent=4, sort_keys=True, ensure_ascii=False) for o in objs
    )
    # Rewrite in place so ownership and permissions are preserved.
    with open(path, "r+", encoding="utf8") as f:
        f.seek(0)
        f.write(out)
        f.truncate()
PY
}

# ---------------------------------------------------------------------------
# Dashboard plugin
# ---------------------------------------------------------------------------

plugin_version() {
    sed -n 's/^Version: //p' "$SRC_PLUGIN/EGG-INFO/PKG-INFO"
}

# Zip plugin/ into a Deluge plugin egg at $1. The code is pure Python, so a
# "py3" egg works with every Python 3 Deluge runs on.
build_egg() {
    "$(find_python)" - "$SRC_PLUGIN" "$1" <<'PY'
import os, sys, zipfile

src, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as egg:
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for name in sorted(files):
            path = os.path.join(root, name)
            egg.write(path, os.path.relpath(path, src))
PY
}

# daemon_plugin <daemon config dir> <enable|disable>
# Ask the running daemon to (rescan and) enable or disable the plugin over
# its local RPC port, authenticating as "localclient" from its auth file,
# the same way Deluge's own clients connect locally.
daemon_plugin() {
    [[ -n "$DELUGE_PY" ]] || detect_deluge_python || return 1
    local -a cmd=("$DELUGE_PY" - "$1" "$2" "$PLUGIN_NAME")
    command -v timeout >/dev/null 2>&1 && cmd=(timeout 60 "${cmd[@]}")
    "${cmd[@]}" 2>/dev/null <<'PY'
import json, os, sys

conf_dir, action, name = sys.argv[1:4]


def read_conf(path):
    # Deluge configs are a version header object followed by the config.
    data, objs, idx = open(path, encoding="utf8").read(), [], 0
    decoder = json.JSONDecoder()
    while idx < len(data):
        while idx < len(data) and data[idx].isspace():
            idx += 1
        if idx < len(data):
            obj, idx = decoder.raw_decode(data, idx)
            objs.append(obj)
    return objs[-1] if objs else {}


port = read_conf(os.path.join(conf_dir, "core.conf")).get("daemon_port", 58846)
user = password = None
with open(os.path.join(conf_dir, "auth"), encoding="utf8") as auth:
    for line in auth:
        parts = line.strip().split(":")
        if len(parts) >= 2 and parts[0] == "localclient":
            user, password = parts[0], parts[1]
if not user:
    sys.exit(1)

from twisted.internet import defer, reactor
from deluge.ui.client import client

status = {"code": 1}


@defer.inlineCallbacks
def main():
    try:
        yield client.connect("127.0.0.1", port, user, password)
        if action == "enable":
            yield client.core.rescan_plugins()
            if name in (yield client.core.get_available_plugins()):
                yield client.core.enable_plugin(name)
                status["code"] = 0
        else:
            if name in (yield client.core.get_enabled_plugins()):
                yield client.core.disable_plugin(name)
            status["code"] = 0
        yield client.disconnect()
    except Exception:
        pass
    finally:
        reactor.stop()


reactor.callWhenRunning(main)
reactor.run()
sys.exit(status["code"])
PY
}

# conf_plugin <daemon config dir> <check|add|remove>
# Check, add or remove the plugin in enabled_plugins in core.conf. The
# daemon only writes core.conf on a clean shutdown, so after enabling or
# disabling it over RPC the file is updated too, to match either way.
conf_plugin() {
    "$(find_python)" - "$1/core.conf" "$2" "$PLUGIN_NAME" 2>/dev/null <<'PY'
import json, sys

path, action, name = sys.argv[1:4]
with open(path, encoding="utf8") as f:
    data = f.read()
decoder, objs, idx = json.JSONDecoder(), [], 0
while idx < len(data):
    while idx < len(data) and data[idx].isspace():
        idx += 1
    if idx < len(data):
        obj, idx = decoder.raw_decode(data, idx)
        objs.append(obj)
if not objs:
    sys.exit(1)
plugins = objs[-1].setdefault("enabled_plugins", [])
if action == "check":
    sys.exit(0 if name in plugins else 1)
if action == "add" and name not in plugins:
    plugins.append(name)
elif action == "remove" and name in plugins:
    plugins.remove(name)
else:
    sys.exit(0)
out = "".join(json.dumps(o, indent=4, sort_keys=True, ensure_ascii=False) for o in objs)
# Rewrite in place so ownership and permissions are preserved.
with open(path, "r+", encoding="utf8") as f:
    f.seek(0)
    f.write(out)
    f.truncate()
PY
}

install_plugin() {
    local c egg
    # A fresh file name on every install: a running daemon caches the table of
    # contents of an egg it has seen by path, and reads a replaced file at the
    # same path with stale offsets. The build stamp is a PEP 440 local version.
    egg="${PLUGIN_NAME}-$(plugin_version)+$(date +%Y%m%d%H%M%S)-py3.egg"
    if ((${#DAEMON_DIRS[@]} == 0)); then
        warn "no Deluge daemon config (core.conf) found; skipping the dashboard"
        warn "plugin. Use --config-dir to point at the daemon's config directory."
        return 0
    fi
    for c in "${DAEMON_DIRS[@]}"; do
        if [[ ! -d "$c/plugins" ]]; then
            mkdir -p "$c/plugins"
            chown --reference="$c" "$c/plugins" 2>/dev/null || true
        fi
        rm -rf "$c/plugins/${PLUGIN_NAME}"-*.egg
        build_egg "$c/plugins/$egg"
        chmod 0644 "$c/plugins/$egg"
        chown --reference="$c" "$c/plugins/$egg" 2>/dev/null || true
        ok "installed the dashboard plugin to $c/plugins/$egg"

        if daemon_plugin "$c" enable; then
            conf_plugin "$c" add || true
            ok "enabled the $PLUGIN_NAME plugin in the running daemon"
            PLUGIN_ENABLED=1
        elif [[ -z "$(deluged_pids)" ]] && conf_plugin "$c" add; then
            ok "enabled $PLUGIN_NAME in $c/core.conf; it loads when deluged starts"
            PLUGIN_ENABLED=1
        else
            warn "couldn't reach the daemon for $c to enable the plugin."
            warn "Enable \"$PLUGIN_NAME\" in Preferences > Plugins (restart deluged"
            warn "first if it isn't listed there)."
        fi
    done
}

uninstall_plugin() {
    local c
    for c in "${DAEMON_DIRS[@]}"; do
        compgen -G "$c/plugins/${PLUGIN_NAME}-*.egg" >/dev/null || continue
        if daemon_plugin "$c" disable; then
            ok "disabled the $PLUGIN_NAME plugin in the running daemon"
        elif conf_plugin "$c" check && [[ -n "$(deluged_pids)" ]]; then
            warn "couldn't reach the daemon for $c to disable the plugin; Deluge"
            warn "will report it missing on next start and carry on without it."
        fi
        conf_plugin "$c" remove || true
        rm -rf "$c/plugins/${PLUGIN_NAME}"-*.egg
        ok "removed the dashboard plugin from $c/plugins"
    done
}

# ---------------------------------------------------------------------------
# Service handling
# ---------------------------------------------------------------------------

active_web_units() {
    command -v systemctl >/dev/null 2>&1 || return 0
    systemctl list-units --type=service --state=active --plain --no-legend \
        'deluge-web*' 'deluge*web*' 2>/dev/null | awk '!seen[$1]++ {print $1}' || true
}

stop_web() {
    ((RESTART)) || return 0
    local unit
    for unit in $(active_web_units); do
        info "Stopping ${unit}"
        if systemctl stop "$unit"; then
            STOPPED_UNITS+=("$unit")
        else
            warn "could not stop ${unit}"
        fi
    done
}

start_web() {
    local unit
    for unit in "${STOPPED_UNITS[@]}"; do
        info "Starting ${unit}"
        if systemctl start "$unit"; then
            ok "${unit} restarted"
        else
            warn "could not start ${unit}; start it manually"
        fi
    done
    STOPPED_UNITS=()
}

trap 'start_web' EXIT

# deluge-web rewrites web.conf when it shuts down, so an edit made while it is
# running would be lost. Returns non-zero if it is still running.
ensure_web_stopped() {
    local pids
    pids="$(deluge_web_pids | tr '\n' ' ')"
    [[ -z "${pids// /}" ]] && return 0
    warn "deluge-web is running (pid ${pids% }) outside a systemd service this"
    warn "script can manage, and would overwrite web.conf when it exits."
    if ((ASSUME_YES)) || [[ ! -t 0 ]]; then
        return 1
    fi
    printf '  Stop deluge-web now, then press Enter to continue (Ctrl-C to abort)... '
    read -r _
    pids="$(deluge_web_pids | tr '\n' ' ')"
    [[ -z "${pids// /}" ]]
}

confirm() {
    ((ASSUME_YES)) && return 0
    [[ -t 0 ]] || return 0
    local reply
    printf '%s [Y/n] ' "$1"
    read -r reply
    [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

# Ask whether to install the dashboard plugin along with the theme, unless
# --dashboard/--theme-only said so. Without a terminal, or with --yes,
# install both.
choose_components() {
    [[ -n "$PLUGIN" ]] && return 0
    if ((ASSUME_YES)) || [[ ! -t 0 ]]; then
        PLUGIN=1
        return 0
    fi
    info "What would you like to install?"
    printf '    %s1)%s Theme + dashboard %s(recommended)%s\n' "$C_BOLD" "$C_RESET" "$C_GREEN" "$C_RESET"
    printf '       %sThe Darkhand dashboard layout plugin, with the theme as its fallback%s\n' "$C_DIM" "$C_RESET"
    printf '    %s2)%s Theme only\n' "$C_BOLD" "$C_RESET"
    printf '       %sDeluge'"'"'s standard layout in the Darkhand colours%s\n' "$C_DIM" "$C_RESET"
    local reply
    while :; do
        printf '  Choose [1]: '
        read -r reply || die "aborted"
        case "$reply" in
            "" | 1) PLUGIN=1 && break ;;
            2) PLUGIN=0 && break ;;
            *) warn "please enter 1 or 2" ;;
        esac
    done
    printf '\n'
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

require_web_dirs() {
    detect_web_dirs
    ((${#WEB_DIRS[@]})) || die "could not find a Deluge web UI install.
       Pass it explicitly, e.g. --web-dir /usr/lib/python3/dist-packages/deluge/ui/web"
    local d
    for d in "${WEB_DIRS[@]}"; do
        [[ -d "$d/themes/css" ]] ||
            die "$d does not look like a Deluge 2.x web directory (no themes/css)"
    done
}

check_writable() {
    local d
    for d in "$@"; do
        [[ -w "$d" ]] || die "no write access to $d (try again with sudo)"
    done
}

cmd_install() {
    [[ -f "$SRC_CSS" ]] || die "theme file not found: $SRC_CSS"
    require_web_dirs
    detect_config_dirs
    choose_components

    if ((PLUGIN)) && [[ ! -d "$SRC_PLUGIN" ]]; then
        warn "the dashboard plugin isn't in this copy ($SRC_PLUGIN); installing the theme only"
        PLUGIN=0
    fi

    local d c
    # Theme only over an earlier dashboard install: take the plugin out, so
    # what's installed matches the choice.
    if ((!PLUGIN)); then
        for c in "${DAEMON_DIRS[@]}"; do
            compgen -G "$c/plugins/${PLUGIN_NAME}-*.egg" >/dev/null && REMOVE_PLUGIN=1
        done
    fi

    if ((PLUGIN)); then
        info "Installing the Darkhand theme and dashboard"
    else
        info "Installing the Darkhand theme"
    fi
    for d in "${WEB_DIRS[@]}"; do printf '    web UI:  %s\n' "$d"; done
    for c in "${DAEMON_DIRS[@]}"; do
        if ((PLUGIN)); then
            printf '    plugin:  %s/plugins\n' "$c"
        elif ((REMOVE_PLUGIN)) && compgen -G "$c/plugins/${PLUGIN_NAME}-*.egg" >/dev/null; then
            printf '    plugin:  %s/plugins %s(removing the dashboard plugin)%s\n' "$c" "$C_DIM" "$C_RESET"
        fi
    done
    if ((ACTIVATE)); then
        if ((${#CONFIG_DIRS[@]})); then
            for c in "${CONFIG_DIRS[@]}"; do printf '    config:  %s/web.conf\n' "$c"; done
        else
            printf '    config:  %s(no web.conf found)%s\n' "$C_DIM" "$C_RESET"
        fi
    fi
    confirm "Continue?" || die "aborted"

    for d in "${WEB_DIRS[@]}"; do
        check_writable "$d/themes/css"
        [[ -f "$d/themes/css/$BASE_THEME_FILE" ]] ||
            warn "$d has no $BASE_THEME_FILE; the theme depends on it"
    done
    if ((ACTIVATE)); then
        for c in "${CONFIG_DIRS[@]}"; do check_writable "$c/web.conf" "$c"; done
    fi
    if ((PLUGIN || REMOVE_PLUGIN)); then
        for c in "${DAEMON_DIRS[@]}"; do check_writable "$c"; done
    fi

    for d in "${WEB_DIRS[@]}"; do
        install -m 0644 "$SRC_CSS" "$d/themes/css/$THEME_FILE"
        ok "copied $THEME_FILE to $d/themes/css"
        if [[ -d "$SRC_ASSETS" ]]; then
            check_writable "$d/themes"
            rm -rf "${d:?}/themes/${ASSET_DIR:?}"
            cp -R "$SRC_ASSETS" "$d/themes/$ASSET_DIR"
            chmod -R u=rwX,go=rX "$d/themes/$ASSET_DIR"
            ok "copied fonts and icons to $d/themes/$ASSET_DIR"
        fi
    done

    # deluge-web has to restart to pick up (or drop) the plugin, and must be
    # stopped while web.conf is edited.
    local web_stopped=0
    if { ((ACTIVATE)) && ((${#CONFIG_DIRS[@]})); } || ((PLUGIN || REMOVE_PLUGIN)); then
        stop_web
        ensure_web_stopped && web_stopped=1
    fi

    if ((ACTIVATE)) && ((${#CONFIG_DIRS[@]})); then
        ((web_stopped)) ||
            die "deluge-web is still running. Stop it and re-run, or use --no-activate
       and select the theme in Preferences > Interface (Deluge 2.2+)."
        local old
        for c in "${CONFIG_DIRS[@]}"; do
            old="$(conf_theme "$c/web.conf" "$THEME_NAME")"
            if [[ "$old" != "$THEME_NAME" ]]; then
                printf '%s\n' "$old" >"$c/$PREV_FILE"
                chown --reference="$c/web.conf" "$c/$PREV_FILE" 2>/dev/null || true
            fi
            ok "set theme to '$THEME_NAME' in $c/web.conf (was '$old')"
        done
    fi

    if ((PLUGIN)); then
        install_plugin
    elif ((REMOVE_PLUGIN)); then
        uninstall_plugin
    fi
    start_web

    printf '\n'
    info "Done."
    if ((!ACTIVATE)) || ((!${#CONFIG_DIRS[@]})); then
        printf '    Select "Darkhand" in Preferences > Interface > Theme (Deluge 2.2+),\n'
        printf '    or set "theme": "%s" in web.conf while deluge-web is stopped.\n' "$THEME_NAME"
    elif ((!RESTART)) || ((!web_stopped)) || ((${#STOPPED_UNITS[@]} == 0)); then
        printf '    (Re)start deluge-web, then reload the page.\n'
    else
        printf '    Reload the Web UI in your browser (Ctrl+Shift+R to bypass the cache).\n'
    fi
    if ((PLUGIN_ENABLED)); then
        printf '    The Darkhand dashboard layout is enabled. If you disable the Darkhand\n'
        printf '    plugin (Preferences > Plugins), the Web UI falls back to the Darkhand\n'
        printf '    theme with Deluge'"'"'s standard layout.\n'
    fi
}

cmd_uninstall() {
    require_web_dirs
    detect_config_dirs

    info "Removing Darkhand theme"
    confirm "Continue?" || die "aborted"

    uninstall_plugin

    local d c old prev
    local -a to_restore=()
    for c in "${CONFIG_DIRS[@]}"; do
        old="$(conf_theme "$c/web.conf")"
        [[ "$old" == "$THEME_NAME" || -f "$c/$PREV_FILE" ]] && to_restore+=("$c")
    done

    if ((${#to_restore[@]})); then
        for c in "${to_restore[@]}"; do check_writable "$c/web.conf" "$c"; done
        stop_web
        if ! ensure_web_stopped; then
            warn "leaving web.conf untouched; once the theme file is gone Deluge"
            warn "falls back to its default theme the next time deluge-web starts."
            to_restore=()
        fi
        for c in "${to_restore[@]}"; do
            prev="$DEFAULT_THEME"
            [[ -f "$c/$PREV_FILE" ]] && prev="$(head -n1 "$c/$PREV_FILE")"
            [[ -n "$prev" && "$prev" != "$THEME_NAME" ]] || prev="$DEFAULT_THEME"
            old="$(conf_theme "$c/web.conf")"
            if [[ "$old" == "$THEME_NAME" ]]; then
                conf_theme "$c/web.conf" "$prev" >/dev/null
                ok "restored theme '$prev' in $c/web.conf"
            fi
            rm -f "$c/$PREV_FILE"
        done
    fi

    for d in "${WEB_DIRS[@]}"; do
        if [[ -f "$d/themes/css/$THEME_FILE" || -d "$d/themes/$ASSET_DIR" ]]; then
            check_writable "$d/themes/css" "$d/themes"
            rm -f "$d/themes/css/$THEME_FILE"
            rm -rf "${d:?}/themes/${ASSET_DIR:?}"
            ok "removed $THEME_FILE and $ASSET_DIR/ from $d/themes"
        else
            ok "not installed in $d"
        fi
    done

    start_web
    printf '\n'
    info "Done. Reload the Web UI in your browser."
}

cmd_status() {
    detect_web_dirs
    detect_config_dirs

    info "Deluge web UI installs"
    if ((${#WEB_DIRS[@]} == 0)); then
        warn "none found (use --web-dir)"
    fi
    local d c
    for d in "${WEB_DIRS[@]}"; do
        if [[ -f "$d/themes/css/$THEME_FILE" ]]; then
            if cmp -s "$SRC_CSS" "$d/themes/css/$THEME_FILE" &&
                { [[ ! -d "$SRC_ASSETS" ]] ||
                    diff -rq "$SRC_ASSETS" "$d/themes/$ASSET_DIR" >/dev/null 2>&1; }; then
                ok "$d  ${C_GREEN}installed${C_RESET}"
            else
                ok "$d  ${C_YELLOW}installed (differs from this copy)${C_RESET}"
            fi
        else
            printf '  - %s  %snot installed%s\n' "$d" "$C_DIM" "$C_RESET"
        fi
    done

    info "Web UI configs"
    if ((${#CONFIG_DIRS[@]} == 0)); then
        warn "no web.conf found (use --config-dir)"
    fi
    for c in "${CONFIG_DIRS[@]}"; do
        printf '  - %s/web.conf  theme: %s\n' "$c" "$(conf_theme "$c/web.conf" 2>/dev/null || echo '?')"
    done

    info "Dashboard plugin"
    if ((${#DAEMON_DIRS[@]} == 0)); then
        warn "no daemon config (core.conf) found (use --config-dir)"
    fi
    for c in "${DAEMON_DIRS[@]}"; do
        if compgen -G "$c/plugins/${PLUGIN_NAME}-*.egg" >/dev/null; then
            if conf_plugin "$c" check; then
                ok "$c/plugins  ${C_GREEN}installed, enabled${C_RESET}"
            else
                ok "$c/plugins  ${C_YELLOW}installed, not enabled${C_RESET}"
            fi
        else
            printf '  - %s/plugins  %snot installed%s\n' "$c" "$C_DIM" "$C_RESET"
        fi
    done

    local units pids
    units="$(active_web_units | tr '\n' ' ')"
    pids="$(deluge_web_pids | tr '\n' ' ')"
    info "deluge-web"
    printf '  - systemd units: %s\n' "${units:-none active}"
    printf '  - processes:     %s\n' "${pids:-none running}"
}

# install/uninstall write into Deluge's package directory, edit web.conf files
# owned by other users and stop/start services, so they need root. status is
# read-only and may run unprivileged (it just sees less of other users' state).
require_root() {
    ((EUID == 0)) && return 0
    printf '%serror:%s "%s" must be run as root.\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$ACTION" >&2
    printf '       Try: sudo %s\n' "$ORIG_CMD" >&2
    exit 1
}

main() {
    parse_args "$@"
    [[ "$ACTION" == status ]] || require_root
    case "$ACTION" in
        install) cmd_install ;;
        uninstall) cmd_uninstall ;;
        status) cmd_status ;;
    esac
}

ORIG_CMD="$0${*:+ $*}"
main "$@"
