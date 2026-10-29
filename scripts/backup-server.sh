#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../deploy" && pwd)/server-lib.sh"
gx_load_env
gx_docker
umask 077
[[ ! -L "$GX_ROOT/backups" ]] || gx_die 'Refusing symbolic link backups directory.'
mkdir -p "$GX_ROOT/backups"
chmod 700 "$GX_ROOT/backups"
backup_dir="$GX_ROOT/backups/server-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir "$backup_dir"
touch "$backup_dir/INCOMPLETE"
cp "$GX_ENV" "$backup_dir/server.env"
"${GX_COMPOSE[@]}" exec -T db pg_dump -U guanxing -d guanxing -Fc > "$backup_dir/database.dump"
"${GX_COMPOSE[@]}" images --format json > "$backup_dir/images.json"
chmod 600 "$backup_dir"/*
rm "$backup_dir/INCOMPLETE"
printf 'Backup complete: %s\n' "$backup_dir"
printf 'Contains private account data and encryption keys. Copy this directory to protected storage outside the server.\n'
