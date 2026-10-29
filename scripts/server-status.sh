#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../deploy" && pwd)/server-lib.sh"
gx_load_env
gx_docker
"${GX_COMPOSE[@]}" ps
"${GX_COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const h=await r.json(); console.log(JSON.stringify({ok:h.ok,mode:h.mode,needsSetup:h.needsSetup,version:h.version})); if(!r.ok)process.exit(1)}).catch(()=>{console.error('Application health check failed.');process.exit(1)})"
