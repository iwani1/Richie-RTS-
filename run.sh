#!/usr/bin/env bash
# Richie TMS — one entry point for the things you actually do on a workstation.
#
#   ./run.sh setup     first-time: check tools, create .env, start the database, migrate, build
#   ./run.sh start     run the production build on http://localhost:3000
#   ./run.sh stop      stop the server listening on that port (only if it is this application)
#   ./run.sh dev       run the development server with hot reload
#   ./run.sh check     typecheck, lint, tests, production build
#   ./run.sh doctor    diagnose a first run: config, port, container, connection, migrations
#   ./run.sh health    ask the running server whether it can reach PostgreSQL
#   ./run.sh backup    write a full backup to ./backups/
#   ./run.sh seed      load demo records (needs ALLOW_DEMO_SEED + DEMO_ADMIN_PASSWORD)
#   ./run.sh reset     empty every table (keeps the schema)
#   ./run.sh db-reset-container
#                      delete the database container and its volume, clear a stale port forwarder,
#                      and start a clean one. Destroys the database.
#   ./run.sh nuke     start from nothing: remove the container, volume, image, .env, node_modules
#                      and build output. The checkout itself survives; git is untouched.
#
# Full instructions, including systemd and HTTPS: docs/SETUP_AND_DEPLOYMENT.md
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

require_node() {
  command -v node >/dev/null || fail "Node.js is not installed. On Fedora: sudo dnf install -y nodejs npm"
  local major minor
  major=$(node -p 'process.versions.node.split(".")[0]')
  minor=$(node -p 'process.versions.node.split(".")[1]')
  if [ "$major" -lt 20 ] || { [ "$major" -eq 20 ] && [ "$minor" -lt 19 ]; }; then
    fail "Node $(node -v) is too old. This application needs 20.19 or newer (22 LTS recommended)."
  fi
}

require_env() {
  [ -f .env ] || fail ".env is missing. Run: cp .env.example .env — then fill it in (see docs/SETUP_AND_DEPLOYMENT.md §3.2)."
}

require_deps() {
  [ -d node_modules ] || fail "Dependencies are not installed. Run: npm ci"
}

# Installs exactly the lockfile. `npm ci` also cleans a half-populated node_modules, which is what
# a failed first attempt tends to leave behind, so it is always the right call here.
require_deps_install() {
  npm ci || fail "npm ci failed. Check your network, then run it again."
}

# Is the database reachable? A predicate: it returns 1 instead of exiting, so callers can retry.
# It used to call fail() here, which meant the first probe of a container that was still
# initialising killed the whole run, with the message thrown away by callers that silenced stderr.
db_reachable() {
  [ -f .env ] || return 1
  node -e '
    const { readFileSync } = require("node:fs");
    const text = readFileSync(".env", "utf8");
    const match = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (!match) process.exit(2);
    const { Client } = require("pg");
    const client = new Client({ connectionString: match[1], connectionTimeoutMillis: 3000 });
    client.connect().then(() => client.end()).catch(() => process.exit(1));
  ' 2>/dev/null
}

require_db() {
  require_env
  db_reachable || fail "PostgreSQL is not reachable with DATABASE_URL from .env. Is the database running? (podman-compose up -d db)"
}

# The port the application listens on. `PORT=3001 ./run.sh start` moves it.
app_port() { printf '%s' "${PORT:-3000}"; }

# Process ids listening on a TCP port. Empty when the port is free.
listening_pids() {
  ss -ltnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
}

# What a process is running, for the operator's benefit.
pid_command() { ps -p "$1" -o args= 2>/dev/null || true; }

# The compose command available here, empty if there is none.
compose_cmd() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
  elif command -v podman-compose >/dev/null; then
    printf 'podman-compose'
  elif command -v podman >/dev/null && podman compose version >/dev/null 2>&1; then
    printf 'podman compose'
  fi
}

# The published database port from .env, defaulting to 5433.
env_port() {
  local port
  port=$(sed -n 's/^POSTGRES_PORT="\{0,1\}\([0-9]*\)"\{0,1\}.*/\1/p' .env 2>/dev/null | tail -1)
  [ -n "$port" ] || port=5433
  printf '%s' "$port"
}

# Finds out who holds the database port and how to get it back. Podman leaves a "rootlessport"
# forwarder behind when a container fails to start, and that orphan keeps the port bound across
# `down`/`up`, which is the most confusing first-run failure on Fedora.
port_hint() {
  local port
  port=$(env_port)
  say "The database container could not start."
  local holder
  holder=$(ss -ltnp 2>/dev/null | grep -E "[:.]$port[[:space:]]" | head -1)
  case "$holder" in
    *rootlessport*)
      say "Port $port is held by a leftover Podman port forwarder (rootlessport), not by PostgreSQL."
      say "That is an orphan from an earlier container that failed. Clear it with:"
      say "    ./run.sh db-reset-container        (deletes the container and its data, then starts clean)"
      ;;
    *postgres*)
      say "Port $port is held by another PostgreSQL on this machine."
      say "Either stop it, or keep it and move the container: set POSTGRES_PORT=\"5433\" in .env,"
      say "put the same port in DATABASE_URL, then re-run: ./run.sh setup"
      ;;
    "")
      say "Nothing is listening on port $port. Check: podman-compose logs db"
      ;;
    *)
      say "Port $port is held by another process:"
      say "    $holder"
      say "Free it, or set POSTGRES_PORT to a free port and match DATABASE_URL to it."
      ;;
  esac
}

# The compose command available here, empty if there is none.

# The status line of our container, empty when there is no such container.
container_state() {
  if command -v podman >/dev/null; then
    podman ps -a --filter name=^richie-tms-db$ --format '{{.Status}}' 2>/dev/null | head -1
  elif command -v docker >/dev/null; then
    docker ps -a --filter name=^richie-tms-db$ --format '{{.Status}}' 2>/dev/null | head -1
  fi
}

# Waits up to $1 seconds for the database to accept connections. Returns as soon as it does, and
# returns at once if the container has exited: a dead container never starts answering, and a
# silent minute is what turns that into a mystery.
wait_for_db() {
  local limit=${1:-60} waited=0 state
  while [ "$waited" -lt "$limit" ]; do
    db_reachable && return 0
    state=$(container_state)
    case "$state" in
      Exited*|Dead*|Restarting*) return 1 ;;
    esac
    sleep 1
    waited=$((waited + 1))
    if [ $((waited % 15)) -eq 0 ]; then say "  still waiting for the database (${waited}s)..."; fi
  done
  return 1
}

# Why a database container is not answering, in the operator's language. Prints the container's
# own last words, because the most common cause (a wrong volume path, a bad volume, a refused
# password) is stated there and nowhere else.
database_diagnosis() {
  local up
  up=$(compose_cmd)
  say "The database container is not answering. Its last log lines:"
  if [ -n "$up" ]; then
    $up logs --tail 25 db 2>&1 | sed 's/^/    /' || true
  elif command -v podman >/dev/null; then
    podman logs --tail 25 richie-tms-db 2>&1 | sed 's/^/    /' || true
  elif command -v docker >/dev/null; then
    docker logs --tail 25 richie-tms-db 2>&1 | sed 's/^/    /' || true
  fi
  say "    status: $(container_state)"
  if [ -n "$up" ] && $up logs --tail 40 db 2>&1 | grep -qi "there appears to be PostgreSQL data"; then
    say ""
    say "The volume holds data from an earlier layout (or from PostgreSQL before 18), and the 18+"
    say "image refuses to start on it. Start from nothing:"
    say "    ./run.sh nuke      (deletes the container, its volume, .env and build output)"
    say "    ./run.sh setup"
  fi
  port_hint
}

compose_up() {
  local up
  up=$(compose_cmd)
  if [ -z "$up" ]; then
    say "No docker/podman compose found. If PostgreSQL is already running on this machine, that is fine."
    return 0
  fi
  if ! $up up -d db; then
    port_hint
    return 1
  fi
}

case "${1:-help}" in
  setup)
    require_node
    if [ ! -f .env ]; then
      # Generates the database password and the session secret in one pass, so the two places
      # that must agree (DATABASE_URL and POSTGRES_PASSWORD) are always written together.
      node scripts/init-env.mjs || fail "Could not write .env."
    else
      say ".env already exists; leaving it untouched."
      if grep -q "change-me\|replace-me" .env; then
        fail "It still contains example values. Either run: npm run env:init -- --force
or edit it by hand (docs/SETUP_AND_DEPLOYMENT.md §3.2)."
      fi
    fi

    # Dependencies first: everything below needs them, including the connection check.
    require_deps_install
    compose_up || fail "Database start failed. Read the hint above, or docs/SETUP_AND_DEPLOYMENT.md §9."
    say "Waiting for PostgreSQL to accept connections..."
    if ! wait_for_db 60; then
      database_diagnosis
      fail "The database never became reachable. The reason is above."
    fi
    npm run db:migrate
    npm run build
    say "Ready. Start it with: ./run.sh start   (then open http://localhost:3000)"
    ;;
  start)
    require_node; require_env; require_deps
    port=$(app_port)
    busy=$(listening_pids "$port")
    if [ -n "$busy" ]; then
      say "Port $port is already in use:"
      for pid in $busy; do printf '    PID %s: %s\n' "$pid" "$(pid_command "$pid")"; done
      fail "That is usually an earlier 'npm start' you forgot to stop.
    Stop it with: ./run.sh stop
    Or run on another port: PORT=3001 ./run.sh start"
    fi
    if [ ! -f .next/BUILD_ID ]; then
      say "No production build yet (or it was removed). Building first..."
      npm run build || fail "The build failed. Fix the error above, then run ./run.sh start again."
    fi
    npm start
    ;;
  dev)
    require_node; require_env; require_deps
    npm run dev
    ;;
  check)
    require_node; require_deps
    npm run check
    ;;
  health)
    curl -sS --fail-with-body http://localhost:3000/api/health || fail "No answer on localhost:3000. Is the app running?"
    echo
    ;;
  backup)
    require_env; require_deps
    mkdir -p backups
    target="backups/richie-$(date +%Y-%m-%d-%H%M).json"
    npm run db:backup -- "$target"
    say "Keep $target encrypted and off this machine."
    ;;
  seed)
    require_env; require_deps
    npm run db:seed
    ;;
  reset)
    require_env; require_deps
    npm run db:reset
    ;;
  db-reset-container)
    require_env
    say "This deletes the PostgreSQL container and its volume, then starts a clean one."
    read -r -p "Type 'yes' to continue: " answer
    [ "$answer" = "yes" ] || fail "Cancelled."
    local up=""
    if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then up="docker compose";
    elif command -v podman-compose >/dev/null; then up="podman-compose";
    elif command -v podman >/dev/null; then up="podman compose";
    else fail "No docker/podman compose found."
    fi
    # Order matters: remove the container, then kill the forwarder it left behind, then start.
    $up down -v || true
    (podman rm -f richie-tms-db || docker rm -f richie-tms-db) >/dev/null 2>&1 || true
    pkill -f rootlessport >/dev/null 2>&1 || true
    sleep 1
    if ss -ltn 2>/dev/null | grep -qE ":$(env_port) "; then
      port_hint
      fail "The port is still held after cleanup."
    fi
    $up up -d db || { port_hint; fail "The database still will not start."; }
    say "Waiting for PostgreSQL to become healthy..."
    if ! wait_for_db 60; then
      database_diagnosis
      fail "The container is up but the database is not answering."
    fi
    say "Database is up. Now create the schema and start the app:"
    say "    npm run db:migrate && ./run.sh start"
    ;;
  nuke)
    say "This deletes, on this machine:"
    say "  - the database container 'richie-tms-db' and its volume (all records)"
    say "  - the postgres image, .env, node_modules and the .next build output"
    say "It does not touch the git checkout or your source files."
    read -r -p "Type 'nuke' to continue: " answer
    [ "$answer" = "nuke" ] || fail "Cancelled. Nothing was deleted."

    up=$(compose_cmd)
    if [ -n "$up" ]; then
      $up down -v --remove-orphans >/dev/null 2>&1 || true
      say "Compose project removed."
    fi
    if command -v podman >/dev/null; then
      podman rm -f -v richie-tms-db >/dev/null 2>&1 || true
      for vol in $(podman volume ls --format '{{.Name}}' 2>/dev/null | grep -E 'richie[-_]pgdata' || true); do
        podman volume rm -f "$vol" >/dev/null 2>&1 || true
      done
      podman image rm -f docker.io/library/postgres:18-alpine >/dev/null 2>&1 || true
      say "Container, volume and image removed."
    elif command -v docker >/dev/null; then
      docker rm -f -v richie-tms-db >/dev/null 2>&1 || true
      for vol in $(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E 'richie[-_]pgdata' || true); do
        docker volume rm -f "$vol" >/dev/null 2>&1 || true
      done
      docker image rm -f docker.io/library/postgres:18-alpine >/dev/null 2>&1 || true
      say "Container, volume and image removed."
    fi
    # A forwarder outlives the container it was created for, and keeps the port bound.
    pkill -f rootlessport >/dev/null 2>&1 || true
    rm -rf .env node_modules .next
    say "Removed .env, node_modules and .next."
    say ""
    say "The checkout is clean. Start again with:"
    say "    ./run.sh setup"
    say "    ./run.sh start"
    ;;

  stop)
    port=$(app_port)
    pids=$(listening_pids "$port")
    if [ -z "$pids" ]; then say "Nothing is listening on port $port."; exit 0; fi
    for pid in $pids; do
      command=$(pid_command "$pid")
      case "$command" in
        *next*|*node*)
          say "Stopping PID $pid: $command"
          kill "$pid" 2>/dev/null || true
          ;;
        *)
          # Something unrelated to this application: say so rather than killing it.
          fail "Port $port is held by PID $pid ($command), which is not this application. Stop it yourself, or use PORT=3001 ./run.sh start."
          ;;
      esac
    done
    for _ in $(seq 1 10); do
      [ -z "$(listening_pids "$port")" ] && break
      sleep 1
    done
    if [ -n "$(listening_pids "$port")" ]; then
      for pid in $(listening_pids "$port"); do kill -9 "$pid" 2>/dev/null || true; done
      sleep 1
    fi
    [ -z "$(listening_pids "$port")" ] && say "Port $port is free." || fail "Port $port is still in use."
    ;;

  doctor)
    require_deps
    npx tsx scripts/doctor.ts
    ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
