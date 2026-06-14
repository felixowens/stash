#!/usr/bin/env bash
#
# dev-instance.sh — spin up a throwaway, *populated* Stash instance that an
# agent can drive (chrome-devtools, GraphQL) to verify changes for real.
#
# It boots a backend on a free port against a fresh SQLite DB (auto-created +
# migrated to the current appSchemaVersion), then seeds it with performers /
# studios / tags over the live GraphQL API (see dev-seed.py). No setup wizard:
# writing a config.yml makes IsNewSystem() false, so it boots straight into a
# usable, populated UI.
#
# The embedded UI: `make stash` bakes ui/v2.5/build into the binary but never
# rebuilds it, so a fresh build/boot auto-runs `make ui` first whenever ui/v2.5
# sources changed since the last build (else skips it — fingerprint-cached). Use
# `--ui` for live vite HMR instead, or `--no-ui-build` to skip the check entirely.
#
# Commands:
#   up [--ui] [--no-ui-build] [--scenario NAME] [--seed-args "..."]
#                                   ensure ONE instance is up (build/boot/seed if
#                                   needed, else reuse) and print its URL on stdout.
#                                   --ui also (re)starts the vite hot-reload UI.
#                                   --no-ui-build skips the embedded-UI rebuild (fast,
#                                   backend-only). idempotent — callers never pick ports.
#                                   scenarios: default|minimal|empty|multi-image|edge
#   down                            stop processes, remove the instance dir
#   restart [...]                   rebuild backend + reboot, RE-SEED fresh (same flags as up)
#   status                          show whether it's up and where
#   logs [-f]                       print (or follow) the backend log
#   url                             print the URL to hit (UI if running, else backend)
#   gql '<query>' ['<vars-json>']   POST a GraphQL query to the running instance
#
# State lives in $REPO/.dev (gitignored). One instance at a time, on purpose:
# tools that follow (verify-ui, gql) just read .dev/instance.env.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="$REPO/.dev"
ENVF="$DEV/instance.env"
BIN="$DEV/stash-bin"
DB="$DEV/stash.sqlite"
CONF="$DEV/config.yml"
LOG="$DEV/stash.log"
UILOG="$DEV/ui.log"
UIDIR="$REPO/ui/v2.5"
UI_BUILD="$UIDIR/build"
UI_STAMP="$UI_BUILD/.dev-ui-fingerprint"   # lives in gitignored build/, survives .dev wipes

c_grn=$'\e[32m'; c_dim=$'\e[2m'; c_red=$'\e[31m'; c_rst=$'\e[0m'
say()  { printf '%s\n' "$*" >&2; }
ok()   { printf '%s%s%s\n' "$c_grn" "$*" "$c_rst" >&2; }
die()  { printf '%s%s%s\n' "$c_red" "$*" "$c_rst" >&2; exit 1; }

gen_key() { openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | xxd -p | tr -d '\n'; }

free_port() {
  local p
  for p in $(seq 9920 9999); do
    if ! { exec 3<>"/dev/tcp/127.0.0.1/$p"; } 2>/dev/null; then echo "$p"; return 0; fi
    exec 3>&- || true
  done
  die "no free port in 9920-9999"
}

load_env() { [ -f "$ENVF" ] && . "$ENVF" || return 1; }

is_running() {
  load_env 2>/dev/null || return 1
  [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null
}

build_backend() {
  say "${c_dim}building stash binary (make stash)...${c_rst}"
  # Same recipe as a normal dev build; embeds the *current* ui/v2.5/build (kept
  # fresh by ensure_ui_fresh, which callers run first).
  make -C "$REPO" stash OUTPUT="$BIN" >&2 || die "backend build failed (see output above)"
}

# Fingerprint everything that feeds the UI bundle (path+size+mtime of every file
# under ui/v2.5 except node_modules/build/dist). ~10ms. mtime-based, so a bare
# `touch` counts as a change — fine for a dev loop (worst case: one extra build).
ui_fingerprint() {
  find "$UIDIR" \
    -type d \( -name node_modules -o -name build -o -name dist \) -prune -o \
    -type f -printf '%P\t%s\t%T@\n' 2>/dev/null | LC_ALL=C sort | sha1sum | cut -d' ' -f1
}

# True when the embedded bundle is missing or its inputs changed since it was built.
ui_is_stale() {
  [ -d "$UI_BUILD" ] || return 0          # never built
  [ -f "$UI_STAMP" ] || return 0          # built, but not by us → can't trust it
  [ "$(cat "$UI_STAMP" 2>/dev/null)" = "$(ui_fingerprint)" ] && return 1 || return 0
}

# Rebuild the embedded UI bundle iff its sources changed, then re-stamp it.
# `make stash` embeds ui/v2.5/build but never rebuilds it, so without this an
# src/ edit silently never reaches the instance at :9920. The stamp is written
# *after* the build, capturing any build-time file writes so the next run is a
# clean skip. Stamp computed post-build → stored in build/ (survives `.dev` wipe).
ensure_ui_fresh() {
  if ui_is_stale; then
    say "${c_dim}embedded UI stale (ui/v2.5/src changed since last build) — rebuilding (make ui)...${c_rst}"
    make -C "$REPO" ui >&2 || die "UI build failed (see output above)"
    ui_fingerprint >"$UI_STAMP"
    ok "embedded UI rebuilt"
  else
    say "${c_dim}embedded UI up to date — skipping rebuild${c_rst}"
  fi
}

write_config() {
  local port="$1"
  cat >"$CONF" <<YAML
# Generated by scripts/dev-instance.sh — throwaway dev instance. Do not commit.
stash: []
database: $DB
generated: $DEV/generated
cache: $DEV/cache
blobs_storage: DATABASE
host: 0.0.0.0
port: $port
jwt_secret_key: $(gen_key)
session_store_key: $(gen_key)
YAML
}

wait_healthz() {
  local port="$1" i
  for i in $(seq 1 80); do
    curl -fsS "http://localhost:$port/healthz" >/dev/null 2>&1 && return 0
    is_running || die "backend exited during startup — see: $0 logs"
    sleep 0.5
  done
  die "backend did not become healthy within 40s — see: $0 logs"
}

# Start the vite hot-reload UI against the running backend, recording UI_* in the
# env file. Idempotent: a live UI is left running. Call load_env first.
start_ui() {
  if [ -n "${UI_PID:-}" ] && kill -0 "$UI_PID" 2>/dev/null; then return 0; fi
  local uiport; uiport="$(free_port)"
  say "${c_dim}starting vite UI on :$uiport (hot reload)...${c_rst}"
  # Run the vite binary directly (not `pnpm exec vite`): with pnpm in the middle
  # the recorded pid isn't vite's process-group leader, so `down` can't group-kill
  # it. Direct → $! is vite itself, a clean setsid session leader. (Not `pnpm run
  # start --` either — its `--` leaks through and vite ignores --port, binding :3000.)
  # Trailing `</dev/null >/dev/null 2>&1` detaches the subshell's stdio from the
  # caller's — otherwise the backgrounded vite holds the caller's stdout open, so
  # `URL=$(… up --ui)` or `… up --ui | …` hangs forever waiting on EOF.
  ( cd "$REPO/ui/v2.5" && VITE_APP_PLATFORM_URL="$STASH_URL" setsid node_modules/.bin/vite --port "$uiport" --host --strictPort >"$UILOG" 2>&1 & echo $! >"$DEV/ui.pid" ) </dev/null >/dev/null 2>&1
  UI_PID="$(cat "$DEV/ui.pid")"; UI_PORT="$uiport"; UI_URL="http://localhost:$uiport"
  grep -v '^UI_' "$ENVF" >"$ENVF.tmp" 2>/dev/null || true; mv "$ENVF.tmp" "$ENVF"
  { echo "UI_PID=$UI_PID"; echo "UI_PORT=$UI_PORT"; echo "UI_URL=$UI_URL"; } >>"$ENVF"
  # Wait for vite to actually bind before returning, so `up --ui` hands back a URL
  # that's ready to hit — and the server is live for a later `down` to kill cleanly.
  local i
  for i in $(seq 1 60); do
    ss -tlnH "sport = :$uiport" 2>/dev/null | grep -q . && return 0
    kill -0 "$UI_PID" 2>/dev/null || { say "${c_red}vite exited at startup — see $UILOG${c_rst}"; return 0; }
    sleep 0.5
  done
  say "${c_dim}vite slow to bind :$uiport — continuing; see $UILOG${c_rst}"
}

# The one URL a caller should hit: the hot-reload UI if running, else the backend.
primary_url() { echo "${UI_URL:-$STASH_URL}"; }

# Kill whatever is listening on a TCP port, plus its whole process group — a
# teardown backstop, since vite under pnpm doesn't reliably sit in UI_PID's group.
kill_port() {
  local port="$1" lpid pgid
  # `|| true`: under `set -e`, grep finding no listener must not abort the caller.
  lpid=$(ss -tlnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
  [ -z "$lpid" ] && return 0
  pgid=$(ps -o pgid= -p "$lpid" 2>/dev/null | tr -d ' ' || true)
  if [ -n "$pgid" ]; then kill -TERM -- "-$pgid" 2>/dev/null || true
  else kill -TERM "$lpid" 2>/dev/null || true; fi
}

cmd_up() {
  local with_ui=0 seed_args="" skip_ui_build=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --ui) with_ui=1 ;;
      --no-ui-build) skip_ui_build=1 ;;   # fast backend-only (re)start; leave embedded UI as-is
      --scenario) seed_args="$seed_args --scenario $2"; shift ;;
      --seed-args) seed_args="$seed_args $2"; shift ;;
      *) die "unknown flag: $1" ;;
    esac
    shift
  done

  if is_running; then
    load_env
    [ "$with_ui" -eq 1 ] && start_ui   # honor --ui even on an already-running instance
    # reuse doesn't rebuild — flag if the live instance's embedded UI is now stale
    if [ "$with_ui" -eq 0 ] && ui_is_stale; then
      say "${c_dim}note: embedded UI may be stale — \`$0 restart\` to rebuild, or \`up --ui\` for live HMR${c_rst}"
    fi
    ok "already up — reusing → $(primary_url)"
    primary_url                         # stdout: just the URL, for callers
    return 0
  fi

  rm -rf "$DEV"
  mkdir -p "$DEV/generated" "$DEV/cache"

  # Keep the embedded bundle current with src/ before it's baked into the binary.
  # Skipped for --ui (vite serves live src) and --no-ui-build (explicit fast path).
  if [ "$with_ui" -eq 0 ] && [ "$skip_ui_build" -eq 0 ]; then
    ensure_ui_fresh
  fi

  build_backend
  local port; port="$(free_port)"
  write_config "$port"

  say "${c_dim}booting backend on :$port (fresh DB, auto-migrated)...${c_rst}"
  STASH_CONFIG_FILE="$CONF" setsid "$BIN" >"$LOG" 2>&1 &
  local pid=$!
  local url="http://localhost:$port"
  cat >"$ENVF" <<ENV
BACKEND_PID=$pid
BACKEND_PORT=$port
STASH_URL=$url
ENV
  wait_healthz "$port"

  say "${c_dim}seeding via GraphQL...${c_rst}"
  # shellcheck disable=SC2086
  python3 "$REPO/scripts/dev-seed.py" --url "$url" $seed_args >&2 \
    || die "seeding failed (instance still up at $url; see error above)"

  load_env   # re-read so start_ui / primary_url see STASH_URL from the env file
  if [ "$with_ui" -eq 1 ]; then
    start_ui
    ok "UP — built UI: $STASH_URL   |   vite (hot reload): $UI_URL"
  else
    ok "UP — $STASH_URL   (playground: $STASH_URL/playground)"
  fi
  primary_url   # stdout: the URL a caller should hit
}

cmd_down() {
  if load_env 2>/dev/null; then
    for pidvar in BACKEND_PID UI_PID; do
      local pid="${!pidvar:-}"
      [ -n "$pid" ] || continue
      kill -TERM -- "-$pid" 2>/dev/null || true   # its process group…
      kill -TERM "$pid"     2>/dev/null || true   # …and the pid itself (group may not be formed yet)
    done
    # Backstop: the backend pid is a clean group leader, but vite runs under a
    # pnpm wrapper whose group the recorded UI_PID doesn't reliably lead — so the
    # group kills above can miss it. Also kill whatever still holds either port.
    for port in "${UI_PORT:-}" "${BACKEND_PORT:-}"; do
      [ -n "$port" ] && kill_port "$port"
    done
  fi
  rm -rf "$DEV"
  ok "down — instance removed"
}

cmd_restart() { cmd_down; cmd_up "$@"; }

cmd_status() {
  if is_running; then
    load_env
    ok "up → $STASH_URL${UI_URL:+   ui: $UI_URL}"
    say "${c_dim}db: $DB   log: $LOG${c_rst}"
  else
    say "down"
  fi
}

cmd_logs() {
  [ -f "$LOG" ] || die "no log — instance not up?"
  if [ "${1:-}" = "-f" ]; then tail -f "$LOG"; else cat "$LOG"; fi
}

cmd_url() { load_env 2>/dev/null && primary_url || die "not up (run: $0 up)"; }

cmd_gql() {
  load_env 2>/dev/null || die "not up"
  local q="${1:?usage: gql '<query>' ['<vars-json>']}" vars="${2:-{}}"
  python3 - "$STASH_URL" "$q" "$vars" <<'PY'
import json, sys, urllib.request
url, q, vars = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(url.rstrip('/')+'/graphql',
    data=json.dumps({'query': q, 'variables': json.loads(vars)}).encode(),
    headers={'Content-Type': 'application/json'})
print(json.dumps(json.load(urllib.request.urlopen(req, timeout=30)), indent=2))
PY
}

cmd="${1:-}"; shift || true
case "$cmd" in
  up)      cmd_up "$@" ;;
  down)    cmd_down ;;
  restart) cmd_restart "$@" ;;
  status)  cmd_status ;;
  logs)    cmd_logs "$@" ;;
  url)     cmd_url ;;
  gql)     cmd_gql "$@" ;;
  *) say "usage: $0 {up [--ui] [--no-ui-build] [--scenario NAME] [--seed-args \"...\"]|down|restart|status|logs [-f]|url|gql <q> [vars]}"; exit 2 ;;
esac
