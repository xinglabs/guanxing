#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
release_tag="${1:-}"
source_image="${2:-}"
output_dir="${3:-$project_dir/release-artifacts}"
if [[ ! "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  printf 'Usage: package-server-release.sh vX.Y.Z ghcr.io/owner/repo@sha256:DIGEST [output-directory]\n' >&2
  exit 2
fi
if [[ ! "$source_image" =~ ^ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$ ]]; then
  printf 'The source app image must use an immutable GHCR digest.\n' >&2
  exit 2
fi
source_commit="$(git rev-parse HEAD)"
[[ "$(git rev-parse "$release_tag^{commit}")" == "$source_commit" ]] || { printf 'Check out the exact release tag before packaging.\n' >&2; exit 1; }
# Fail rather than package accidentally tracked runtime secrets or user data.
while IFS= read -r path; do
  case "$path" in
    .env.example|.env.server.example) ;;
    .env|.env.*|backups/*|data/*|node_modules/*|release-artifacts/*)
      printf 'Refusing to archive a tracked private/generated path: %s\n' "$path" >&2
      exit 1 ;;
  esac
done < <(git ls-tree -r --name-only HEAD)

command -v docker >/dev/null 2>&1 || { printf 'Docker is required for packaging.\n' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { printf 'sha256sum is required (run on the Linux CI runner).\n' >&2; exit 1; }
mkdir -p "$output_dir"
output_dir="$(cd -- "$output_dir" && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
bundle_name="guanxing-$release_tag-linux-amd64"
bundle="$staging/$bundle_name"
mkdir "$bundle"
git archive HEAD | tar -xf - -C "$bundle"
app_image="guanxing-web:$release_tag"
pg_image='pgvector/pgvector:pg17'
caddy_image='caddy:2-alpine'

docker pull --platform linux/amd64 "$source_image"
docker tag "$source_image" "$app_image"
docker pull --platform linux/amd64 "$pg_image"
docker pull --platform linux/amd64 "$caddy_image"
for image in "$app_image" "$pg_image" "$caddy_image"; do
  [[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" == 'linux/amd64' ]] || { printf 'Image is not linux/amd64: %s\n' "$image" >&2; exit 1; }
done
docker save --output "$bundle/images.tar" "$app_image" "$pg_image" "$caddy_image"
(
  cd "$bundle"
  sha256sum images.tar > images.tar.sha256
)
{
  printf 'RELEASE_VERSION=%s\nSOURCE_COMMIT=%s\nSOURCE_IMAGE=%s\n' "$release_tag" "$source_commit" "$source_image"
  printf 'APP_IMAGE=%s\nPGVECTOR_IMAGE=%s\nCADDY_IMAGE=%s\n' "$app_image" "$pg_image" "$caddy_image"
} > "$bundle/offline-manifest.env"
docker image inspect "$app_image" "$pg_image" "$caddy_image" --format '{{.Id}} {{json .RepoTags}} {{json .RepoDigests}}' > "$bundle/offline-images.txt"
archive="$output_dir/$bundle_name.tar.gz"
tar -czf "$archive" -C "$staging" "$bundle_name"
# GitHub individual release assets are limited to 2 GiB; fail before uploading.
size="$(wc -c < "$archive" | tr -d ' ')"
(( size < 2147483648 )) || { printf 'Release archive exceeds the GitHub asset limit.\n' >&2; exit 1; }
(
  cd "$output_dir"
  sha256sum "$bundle_name.tar.gz" > "$bundle_name.tar.gz.sha256"
)
printf 'Offline bundle ready: %s (%s bytes)\n' "$archive" "$size"
