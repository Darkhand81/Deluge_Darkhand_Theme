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

ACTION=""
WEB_DIRS=()
CONFIG_DIRS=()
PYTHONS=()
ACTIVATE=1
RESTART=1
ASSUME_YES=0

STOPPED_UNITS=()

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
  install      Copy the theme into Deluge and set it as the Web UI theme (root)
  uninstall    Remove the theme and restore the theme used before install (root)
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
  -y, --yes              Do not ask for confirmation.
  -h, --help             Show this help.

${C_BOLD}Examples:${C_RESET}
  sudo ./$(basename "$0") install
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

# Config directory passed to a running deluge-web via -c/--config.
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

detect_web_dirs() {
    ((${#WEB_DIRS[@]})) && return 0

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

    local py dir
    local -a found=() uniq_pys=()
    mapfile -t uniq_pys < <(uniq_list "${pys[@]}")
    for py in "${uniq_pys[@]}"; do
        command -v "$py" >/dev/null 2>&1 || continue
        dir="$("$py" - 2>/dev/null <<'PY' || true
import importlib.util, os
spec = importlib.util.find_spec("deluge")
if spec and spec.submodule_search_locations:
    print(os.path.join(list(spec.submodule_search_locations)[0], "ui", "web"))
PY
)"
        [[ -n "$dir" && -d "$dir/themes/css" ]] && found+=("$dir")
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
    ((${#CONFIG_DIRS[@]})) && return 0

    local -a cands=()
    local pid dir home

    # Config dirs of running deluge-web processes are the most reliable hint.
    for pid in $(deluge_web_pids); do
        dir="$(pid_config_dir "$pid")"
        if [[ -n "$dir" ]]; then
            [[ "$dir" == /* ]] ||
                dir="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)/$dir"
            cands+=("$dir")
            # deluge-web changes into its config directory once running
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

    local c
    mapfile -t CONFIG_DIRS < <(
        for c in "${cands[@]}"; do
            [[ -f "$c/web.conf" ]] && (cd "$c" && pwd -P)
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
    ((ACTIVATE)) && detect_config_dirs

    info "Installing Darkhand theme"
    local d c
    for d in "${WEB_DIRS[@]}"; do printf '    web UI:  %s\n' "$d"; done
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

    if ((ACTIVATE)) && ((${#CONFIG_DIRS[@]})); then
        stop_web
        ensure_web_stopped ||
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
        start_web
    fi

    printf '\n'
    info "Done."
    if ((!ACTIVATE)) || ((!${#CONFIG_DIRS[@]})); then
        printf '    Select "Darkhand" in Preferences > Interface > Theme (Deluge 2.2+),\n'
        printf '    or set "theme": "%s" in web.conf while deluge-web is stopped.\n' "$THEME_NAME"
    elif ((!RESTART)) || ((${#STOPPED_UNITS[@]} == 0)); then
        printf '    Start deluge-web if it is not running, then reload the page.\n'
    else
        printf '    Reload the Web UI in your browser (Ctrl+Shift+R to bypass the cache).\n'
    fi
}

cmd_uninstall() {
    require_web_dirs
    detect_config_dirs

    info "Removing Darkhand theme"
    confirm "Continue?" || die "aborted"

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
