#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../deploy" && pwd)/server-lib.sh"
cd "$GX_ROOT"

build=false pull=false no_pull=false init_only=false domain_set=false domain='' image_set=false image=''
while (( $# )); do
  case "$1" in
    --build) build=true ;;
    --pull) pull=true ;;
    --no-pull) no_pull=true ;;
    --init-only) init_only=true ;;
    --domain) (( $# >= 2 )) || gx_die '--domain needs a hostname.'; domain_set=true; domain="$2"; shift ;;
    --image) (( $# >= 2 )) || gx_die '--image needs an image reference.'; image_set=true; image="$2"; shift ;;
    -h|--help)
      printf 'Usage: ./scripts/start-server.sh [--init-only] [--pull | --build | --no-pull] [--domain example.com] [--image IMAGE]\n'
      printf 'Default: private SSH-tunnel access; secrets remain in .env.server.\n'
      exit 0 ;;
    *) gx_die "Unknown option: $1" ;;
  esac
  shift
done
[[ "$build" != true || "$pull" != true ]] || gx_die 'Choose --build or --pull, not both.'
[[ "$no_pull" != true || ( "$build" != true && "$pull" != true ) ]] || gx_die '--no-pull cannot be combined with --pull or --build.'
if [[ "$domain_set" == true ]]; then gx_validate_domain "$domain"; fi
if [[ "$image_set" == true ]]; then
  [[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9./:@_-]*$ ]] || gx_die 'Invalid image reference.'
fi

gx_init_env
if [[ "$domain_set" == true || "$image_set" == true ]]; then
  if [[ "$domain_set" == true ]]; then GX_DOMAIN="$domain"; fi
  if [[ "$image_set" == true ]]; then GX_APP_IMAGE="$image"; fi
  GX_ORIGIN='http://127.0.0.1:3080,http://localhost:3080'
  if [[ -n "$GX_DOMAIN" ]]; then GX_ORIGIN="https://$GX_DOMAIN,$GX_ORIGIN"; fi
  gx_write_env
  gx_load_env
fi
if [[ "$init_only" == true ]]; then
  printf 'Server configuration is ready. Secrets were not printed.\n'
  exit 0
fi

gx_docker
"${GX_COMPOSE[@]}" config --quiet
if [[ "$pull" == true ]]; then
  "${GX_COMPOSE[@]}" pull || gx_die 'Image download failed; check registry connectivity. Existing volumes and credentials were preserved. See docs/server-deployment.md for offline transfer or --build.'
fi
if [[ "$build" == true ]]; then
  "${GX_COMPOSE[@]}" build app
fi
if [[ -z "$GX_DOMAIN" ]]; then
  # Switching back to tunnel-only mode also stops any previously enabled proxy.
  "${GX_COMPOSE[@]}" --profile https stop proxy
fi
pull_policy=missing
if [[ "$no_pull" == true ]]; then pull_policy=never; fi
"${GX_COMPOSE[@]}" up -d --no-build --pull "$pull_policy"

printf 'Waiting for the application...\n'
ready=false
for (( attempt=1; attempt<=60; attempt++ )); do
  if "${GX_COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const h=await r.json();if(!r.ok||!h.ok||h.mode!=='public')process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 2
done
[[ "$ready" == true ]] || gx_die 'The application is not ready. Run ./scripts/server-status.sh and inspect the health status.'
printf '\nServer is ready. For private first setup, run on your own computer:\n'
printf '  ssh -N -L 3080:127.0.0.1:3000 root@YOUR_SERVER_IP\n'
printf 'Then open http://127.0.0.1:3080/#agent\n'
printf 'On the server, ./scripts/server-setup-token.sh displays the first-setup token in your terminal.\n'
if [[ -n "$GX_DOMAIN" ]]; then
  printf 'HTTPS address: https://%s/ (DNS and inbound 80/443 must be ready).\n' "$GX_DOMAIN"
fi
