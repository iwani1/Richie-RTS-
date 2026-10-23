#!/usr/bin/env bash
# Richie TMS — one entry point for the things you actually do on a workstation.
#
#   ./run.sh setup     first-time: check tools, create .env, start the database, migrate, build
#   ./run.sh start     run the production build on http://localhost:3000
#   ./run.sh dev       run the development server with hot reload
#   ./run.sh check     typecheck, lint, tests, production build
#   ./run.sh health    ask the running server whether it can reach PostgreSQL
#   ./run.sh backup    write a full backup to ./backups/
#   ./run.sh seed      load demo records (needs ALLOW_DEMO_SEED + DEMO_ADMIN_PASSWORD)
#   ./run.sh reset     empty every table (keeps the schema)
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
port_hint() {
  local port
  port=$(sed -n 's/^POSTGRES_PORT="\{0,1\}\([0-9]*\)"\{0,1\}.*/\1/p' .env 2>/dev/null | tail -1)
  [ -n "$port" ] || port=5432
  say "The database container could not start."
  if ss -ltn 2>/dev/null | grep -q ":$port "; then
    say "Port $port is already in use. On Fedora this is usually the distribution's PostgreSQL:"
    say "    sudo systemctl disable --now postgresql"
    say "or keep the host database and move the container instead: set POSTGRES_PORT=\"5433\" in .env,"
    say "put the same port in DATABASE_URL, then re-run: ./run.sh setup"
  fi
}

compose_up() {
  local up=""
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    up="docker compose"
  elif command -v podman-compose >/dev/null; then
    up="podman-compose"
  elif command -v podman >/dev/null && podman compose version >/dev/null 2>&1; then
    up="podman compose"
  else
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
      cp .env.example .env
      say "Created .env. Generating a session secret..."
      secret=$(openssl rand -base64 32)
      # Portable in-place edit: BSD sed and GNU sed disagree about -i.
      node -e '
        const { readFileSync, writeFileSync } = require("node:fs");
        const file = ".env";
        const text = readFileSync(file, "utf8").replace(/SESSION_SECRET=.*/, `SESSION_SECRET="${process.argv[1]}"`);
        writeFileSync(file, text);
      ' "$secret"
      say "A SESSION_SECRET was written for you."
      say "Now set DATABASE_URL and POSTGRES_PASSWORD in .env to the same password, then re-run: ./run.sh setup"
      exit 0
    fi
    compose_up || fail "Database start failed. Read the hint above, or docs/SETUP_AND_DEPLOYMENT.md §9."
    say "Waiting for PostgreSQL..."
    for _ in $(seq 1 30); do require_db && break; sleep 1; done
    require_db
    npm ci
    npm run db:migrate
    npm run build
    say "Ready. Start it with: ./run.sh start   (then open http://localhost:3000)"
    ;;
  start)
    require_node; require_env; require_deps
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
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
