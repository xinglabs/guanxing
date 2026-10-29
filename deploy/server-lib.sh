#!/usr/bin/env bash
# Shared by server scripts. Environment files are parsed as data, never sourced.
GX_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GX_ENV="$GX_ROOT/.env.server"

gx_die() { printf '%s\n' "$*" >&2; exit 1; }

gx_random() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

gx_permissions() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

gx_load_env() {
  [[ ! -L "$GX_ENV" && -f "$GX_ENV" ]] || gx_die 'Expected a regular .env.server file; run ./scripts/start-server.sh.'
  [[ "$(gx_permissions "$GX_ENV")" == 600 ]] || gx_die '.env.server must have mode 600. Run chmod 600 .env.server, then retry.'
  GX_DB_PASSWORD='' GX_APP_SECRET='' GX_SETUP_TOKEN='' GX_DOMAIN=''
  GX_APP_IMAGE='ghcr.io/xinglabs/guanxing:latest'
  GX_PG_IMAGE='pgvector/pgvector:pg17' GX_CADDY_IMAGE='caddy:2-alpine'
  GX_NODE_IMAGE='node:22-bookworm-slim'
  GX_HOSTS='api.deepseek.com,api.openai.com,openrouter.ai'
  local line key value seen=','
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in ''|\#*) continue ;; esac
    [[ "$line" == *=* ]] || gx_die 'Invalid .env.server line. Use plain NAME=value entries.'
    key="${line%%=*}"; value="${line#*=}"
    [[ "$seen" != *",$key,"* ]] || gx_die "Duplicate .env.server field: $key"
    seen="$seen$key,"
    case "$key" in
      POSTGRES_PASSWORD) GX_DB_PASSWORD="$value" ;;
      APP_SECRET) GX_APP_SECRET="$value" ;;
      SETUP_TOKEN) GX_SETUP_TOKEN="$value" ;;
      APP_DOMAIN) GX_DOMAIN="$value" ;;
      APP_IMAGE) GX_APP_IMAGE="$value" ;;
      PGVECTOR_IMAGE) GX_PG_IMAGE="$value" ;;
      CADDY_IMAGE) GX_CADDY_IMAGE="$value" ;;
      NODE_IMAGE) GX_NODE_IMAGE="$value" ;;
      MODEL_ALLOWED_HOSTS) GX_HOSTS="$value" ;;
      APP_ORIGIN) ;; # Recomputed from the validated domain below.
      *) gx_die "Unsupported .env.server field: $key" ;;
    esac
  done < "$GX_ENV"
  [[ "$GX_DB_PASSWORD" =~ ^[a-f0-9]{48,128}$ ]] || gx_die 'POSTGRES_PASSWORD must be 48–128 lowercase hex characters. Never change it on an existing database without a migration.'
  [[ "$GX_APP_SECRET" =~ ^[a-f0-9]{64}$ ]] || gx_die 'APP_SECRET must be 64 lowercase hex characters. Preserve it to decrypt saved model keys.'
  [[ "$GX_SETUP_TOKEN" =~ ^[a-f0-9]{48,128}$ ]] || gx_die 'SETUP_TOKEN must be 48–128 lowercase hex characters.'
  gx_validate_domain "$GX_DOMAIN"
  for value in "$GX_APP_IMAGE" "$GX_PG_IMAGE" "$GX_CADDY_IMAGE" "$GX_NODE_IMAGE"; do
    [[ "$value" =~ ^[a-zA-Z0-9][a-zA-Z0-9./:@_-]*$ ]] || gx_die 'Invalid container image reference in .env.server.'
  done
  [[ "$GX_HOSTS" =~ ^[a-zA-Z0-9.,:-]+$ ]] || gx_die 'MODEL_ALLOWED_HOSTS must be a comma-separated hostname list.'
  GX_ORIGIN='http://127.0.0.1:3080,http://localhost:3080'
  if [[ -n "$GX_DOMAIN" ]]; then GX_ORIGIN="https://$GX_DOMAIN,$GX_ORIGIN"; fi
}

gx_validate_domain() {
  [[ -z "$1" ]] && return 0
  [[ ${#1} -le 253 && "$1" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z][a-z0-9-]*$ && "$1" != *'..'* ]] || gx_die 'Use a lowercase domain such as guanxing.example.com, without scheme, path, wildcard or port.'
  local label
  local old_ifs="$IFS"; IFS='.'; read -r -a gx_labels <<< "$1"; IFS="$old_ifs"
  for label in "${gx_labels[@]}"; do
    [[ ${#label} -le 63 && "$label" != -* && "$label" != *- ]] || gx_die 'Invalid domain label.'
  done
}

gx_write_env() {
  local tmp
  umask 077
  tmp="$(mktemp "$GX_ROOT/.env.server.tmp.XXXXXX")"
  {
    printf '# Private server configuration. Keep this file with database backups.\n'
    printf 'POSTGRES_PASSWORD=%s\nAPP_SECRET=%s\nSETUP_TOKEN=%s\n' "$GX_DB_PASSWORD" "$GX_APP_SECRET" "$GX_SETUP_TOKEN"
    printf 'APP_IMAGE=%s\nPGVECTOR_IMAGE=%s\nCADDY_IMAGE=%s\nNODE_IMAGE=%s\n' "$GX_APP_IMAGE" "$GX_PG_IMAGE" "$GX_CADDY_IMAGE" "$GX_NODE_IMAGE"
    printf 'APP_DOMAIN=%s\nAPP_ORIGIN=%s\nMODEL_ALLOWED_HOSTS=%s\n' "$GX_DOMAIN" "$GX_ORIGIN" "$GX_HOSTS"
  } > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$GX_ENV"
}

gx_init_env() {
  [[ ! -L "$GX_ENV" ]] || gx_die 'Refusing symbolic link .env.server.'
  if [[ ! -e "$GX_ENV" ]]; then
    GX_DB_PASSWORD="$(gx_random 24)"
    GX_APP_SECRET="$(gx_random 32)"
    GX_SETUP_TOKEN="$(gx_random 32)"
    GX_DOMAIN='' GX_ORIGIN='http://127.0.0.1:3080,http://localhost:3080'
    GX_APP_IMAGE='ghcr.io/xinglabs/guanxing:latest'
    GX_PG_IMAGE='pgvector/pgvector:pg17' GX_CADDY_IMAGE='caddy:2-alpine'
    GX_NODE_IMAGE='node:22-bookworm-slim'
    GX_HOSTS='api.deepseek.com,api.openai.com,openrouter.ai'
    # noclobber prevents overwriting secrets if two first-start commands race.
    umask 077
    ( set -o noclobber; : > "$GX_ENV" ) 2>/dev/null || gx_die '.env.server was created by another process; retry after it finishes.'
    gx_write_env
    printf 'Created private .env.server with random secrets. No model was installed.\n'
  fi
  gx_load_env
}

gx_docker() {
  command -v docker >/dev/null 2>&1 || gx_die 'Docker is required. See docs/server-deployment.md.'
  docker compose version >/dev/null 2>&1 || gx_die 'Docker Compose plugin is missing. On Alibaba Cloud Linux 3: sudo dnf install -y docker-compose-plugin'
  docker info >/dev/null 2>&1 || gx_die 'Docker is not running or this account lacks permission.'
  # Export only validated values so inherited shell variables cannot override secrets.
  export POSTGRES_PASSWORD="$GX_DB_PASSWORD" APP_SECRET="$GX_APP_SECRET" SETUP_TOKEN="$GX_SETUP_TOKEN"
  export APP_DOMAIN="$GX_DOMAIN" APP_ORIGIN="$GX_ORIGIN" APP_IMAGE="$GX_APP_IMAGE"
  export PGVECTOR_IMAGE="$GX_PG_IMAGE" CADDY_IMAGE="$GX_CADDY_IMAGE" NODE_IMAGE="$GX_NODE_IMAGE" MODEL_ALLOWED_HOSTS="$GX_HOSTS"
  GX_COMPOSE=(docker compose --project-name guanxing-server --env-file "$GX_ENV" -f "$GX_ROOT/compose.server.yaml")
  if [[ -n "$GX_DOMAIN" ]]; then GX_COMPOSE+=(--profile https); fi
}
