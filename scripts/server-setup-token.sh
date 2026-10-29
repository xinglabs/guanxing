#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../deploy" && pwd)/server-lib.sh"
[[ -t 1 ]] || gx_die 'Run this command in your own trusted terminal; do not redirect the setup token to logs or chat.'
gx_load_env
printf 'First-setup token (only needed until the administrator is created):\n%s\n' "$GX_SETUP_TOKEN"
