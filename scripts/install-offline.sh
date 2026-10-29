#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../deploy" && pwd)/server-lib.sh"
cd "$GX_ROOT"
forward=(--no-pull)
while (( $# )); do
  case "$1" in
    --domain) (( $# >= 2 )) || gx_die '--domain needs a hostname.'; gx_validate_domain "$2"; forward+=(--domain "$2"); shift ;;
    -h|--help) printf 'Usage: ./scripts/install-offline.sh [--domain example.com]\nVerifies and imports the release images, then starts without registry pulls.\n'; exit 0 ;;
    *) gx_die "Unknown option: $1" ;;
  esac
  shift
done
for file in images.tar images.tar.sha256 offline-manifest.env; do
  [[ -f "$file" && ! -L "$file" ]] || gx_die 'Release bundle is incomplete. Download and extract the full linux-amd64 package first.'
done
version='' app_image='' pg_image='' caddy_image='' source_commit='' source_image='' seen=','
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == *=* ]] || gx_die 'Invalid offline manifest.'
  key="${line%%=*}"; value="${line#*=}"
  [[ "$seen" != *",$key,"* ]] || gx_die 'Duplicate offline manifest field.'
  seen="$seen$key,"
  case "$key" in
    RELEASE_VERSION) version="$value" ;;
    APP_IMAGE) app_image="$value" ;;
    PGVECTOR_IMAGE) pg_image="$value" ;;
    CADDY_IMAGE) caddy_image="$value" ;;
    SOURCE_COMMIT) source_commit="$value" ;;
    SOURCE_IMAGE) source_image="$value" ;;
    *) gx_die 'Unexpected offline manifest field.' ;;
  esac
done < offline-manifest.env
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ && "$app_image" == "guanxing-web:$version" ]] || gx_die 'Invalid release version or app image.'
[[ "$source_commit" =~ ^[a-f0-9]{40}$ && "$source_image" =~ ^ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$ ]] || gx_die 'Invalid release source reference.'
[[ "$pg_image" == pgvector/pgvector:pg17 && "$caddy_image" == caddy:2-alpine ]] || gx_die 'Unexpected database or proxy image in release.'
checksum_line="$(cat images.tar.sha256)"
[[ "$checksum_line" =~ ^[a-f0-9]{64}[[:space:]][[:space:]]images\.tar$ ]] || gx_die 'Invalid image checksum file.'
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --check --status images.tar.sha256 || gx_die 'Image archive checksum failed. Download the release again.'
else
  shasum -a 256 --check --status images.tar.sha256 || gx_die 'Image archive checksum failed. Download the release again.'
fi
if [[ -e "$GX_ENV" || -L "$GX_ENV" ]]; then
  gx_load_env
  [[ "$GX_PG_IMAGE" == "$pg_image" && "$GX_CADDY_IMAGE" == "$caddy_image" ]] || gx_die 'Existing database/proxy image settings differ from this bundle. Review the deployment manually; no settings were overwritten.'
fi
command -v docker >/dev/null 2>&1 || gx_die 'Docker is required. See docs/server-deployment.md.'
docker compose version >/dev/null 2>&1 || gx_die 'Install the Docker Compose plugin before continuing.'
docker info >/dev/null 2>&1 || gx_die 'Docker is not available.'
docker load --input images.tar
for image in "$app_image" "$pg_image" "$caddy_image"; do
  [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == 'linux/amd64' ]] || gx_die "Unexpected image architecture: $image"
done
exec "$GX_ROOT/scripts/start-server.sh" "${forward[@]}" --image "$app_image"
