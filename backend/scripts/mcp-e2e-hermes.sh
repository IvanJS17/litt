#!/usr/bin/env bash
# End-to-end check of the LiTT MCP server with Hermes as the MCP client.
#
#   backend/scripts/mcp-e2e-hermes.sh              # Hermes registers itself with its public client metadata (needs internet)
#   LITT_MCP_E2E_CIMD=disabled backend/scripts/mcp-e2e-hermes.sh   # dynamic registration instead (offline)
#
# Starts the real Express app on a random 127.0.0.1 port with an in-memory
# database and a stubbed web session, points an ISOLATED Hermes home at it
# (your own Hermes profile is not touched), and drives `hermes mcp login` and
# `hermes mcp test`. Uses synthetic data only. Needs the `hermes` CLI.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v hermes >/dev/null || { echo "the hermes CLI is not installed" >&2; exit 2; }
HERMES_HOME="$(mktemp -d "${TMPDIR:-/tmp}/litt-mcp-e2e-hermes.XXXXXX")"
export HERMES_HOME MCP_E2E_HERMES=1
trap 'rm -rf "$HERMES_HOME"' EXIT
npx vitest run src/__tests__/integration/mcp.hermes.e2e.test.ts --testTimeout=240000 "$@"
