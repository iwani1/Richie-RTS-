#!/usr/bin/env bash
# Richie TMS — one entry point for the things you actually do on a workstation.
#
#   ./run.sh setup     first-time: check tools, create .env, start the database, migrate, build
#   ./run.sh start     run the production build on http://localhost:3000
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

require_db() {
  require_env
  if ! node -e '
    const { readFileSync } = require("node:fs");
    const text = readFileSync(".env", "utf8");
    const match = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (!match) process.exit(2);
    const { Client } = require("pg");
    const client = new Client({ connectionString: match[1], connectionTimeoutMillis: 3000 });
    client.connect().then(() => client.end()).catch(() => process.exit(1));
  '; then
    fail "PostgreSQL is not reachable with DATABASE_URL from .env. Is the database running? (docker compose up -d db)"
  fi
}

# Explains the two failures a first run actually hits on Fedora: the port taken by the distro's
# own PostgreSQL, and the container coming up with a password that does not match DATABASE_URL.
# The published database port from .env, defaulting to 5433.
env_port() {
  local port
  port=$(env_port)
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
compose_cmd() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    printf 'docker compose'
  elif command -v podman-compose >/dev/null; then
    printf 'podman-compose'
  elif command -v podman >/dev/null && podman compose version >/dev/null 2>&1; then
    printf 'podman compose'
  fi
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
  if command -v podman >/dev/null; then
    podman ps -a --filter name=richie-tms-db --format '    status: {{.Status}}' || true
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
    for _ in $(seq 1 60); do require_db 2>/dev/null && break; sleep 1; done
    if ! require_db 2>/dev/null; then
      database_diagnosis
      fail "The database never became reachable after 60 seconds. See the log lines above."
    fi
    npm run db:migrate
    npm run build
    say "Ready. Start it with: ./run.sh start   (then open http://localhost:3000)"
    ;;
  start)
    require_node; require_env; require_deps
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
    for _ in $(seq 1 60); do require_db 2>/dev/null && break; sleep 1; done
    require_db || fail "The container is up but the database is not answering. Check: podman-compose logs db"
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
      podman volume rm -f richie-tms_richie_pgdata >/dev/null 2>&1 || true
      podman image rm -f docker.io/library/postgres:18-alpine >/dev/null 2>&1 || true
      say "Container, volume and image removed."
    elif command -v docker >/dev/null; then
      docker rm -f -v richie-tms-db >/dev/null 2>&1 || true
      docker volume rm -f richie-tms_richie_pgdata >/dev/null 2>&1 || true
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

  doctor)
    require_deps
    npx tsx scripts/doctor.ts
    ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
