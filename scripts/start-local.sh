#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
open_browser=true
for arg in "$@"; do
  case "$arg" in
    --no-open) open_browser=false ;;
    -h|--help)
      printf 'Usage: ./scripts/start-local.sh [--no-open]\n'
      printf 'Starts the local app and PostgreSQL. No model is downloaded.\n'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf 'Docker with Compose v2 is required. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker is not running. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi

umask 077
if [[ -L .env ]]; then
  printf 'Use a regular local .env file, not a symbolic link.\n' >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# Read values as data. Never source .env as shell code or print credentials.
stored_password=''
app_port=3000
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    POSTGRES_PASSWORD=*) stored_password="${line#POSTGRES_PASSWORD=}" ;;
    APP_PORT=*) app_port="${line#APP_PORT=}" ;;
  esac
done < .env
app_port="${APP_PORT:-$app_port}"
case "$stored_password" in
  ''|'""'|"''")
    generated_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
    env_tmp=".env.tmp.$$"
    trap 'rm -f "${env_tmp:-}"' EXIT
    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in POSTGRES_PASSWORD=*) continue ;; esac
      printf '%s\n' "$line"
    done < .env > "$env_tmp"
    printf 'POSTGRES_PASSWORD=%s\n' "$generated_password" >> "$env_tmp"
    mv "$env_tmp" .env
    unset generated_password
    printf 'Created a random local database password in .env.\n'
    ;;
esac
chmod 600 .env
unset stored_password

case "$app_port" in ''|*[!0-9]*) printf 'APP_PORT must be a numeric port.\n' >&2; exit 1 ;; esac
if (( app_port < 1 || app_port > 65535 )); then
  printf 'APP_PORT must be between 1 and 65535.\n' >&2; exit 1
fi

compose=(docker compose)
"${compose[@]}" config --quiet
"${compose[@]}" up --build -d

printf 'Waiting for the application...\n'
ready=false
for (( attempt=1; attempt<=60; attempt++ )); do
  if "${compose[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  printf 'The application is not ready. Check docker compose logs app.\n' >&2
  exit 1
fi

url="http://127.0.0.1:${app_port}/#agent"
printf 'Guanxing is ready: %s\nSet your administrator password in the first-run page.\n' "$url"
if [[ "$open_browser" == true ]]; then
  if command -v open >/dev/null 2>&1; then open "$url" || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true
  fi
fi
