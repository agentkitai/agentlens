#!/bin/bash
cd /home/amit/projects/agentlens

export DISABLE_EMBEDDINGS=1
export AUTH_DISABLED=true
export PORT=3000
export CORS_ORIGIN="*"

exec node --input-type=module -e "import {startServer} from './packages/server/dist/index.js'; startServer();"
