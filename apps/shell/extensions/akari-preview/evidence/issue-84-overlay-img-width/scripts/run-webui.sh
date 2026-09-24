#!/bin/bash
# usage: run-webui.sh <fixtureDir> <label> <outDir>
set -uo pipefail
REPO=${AKARI_REPO:?}; FIXTURE=$1; LABEL=$2; OUT=$3; HTTP=${I84_HTTP_PORT:-48870}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
WS=$(cd "$(mktemp -d /tmp/issue84-overlay-img-width-web.XXXXXX)" && pwd -P)
cp -R "$REPO/templates/project-default/." "$WS/"; cp -R "$FIXTURE/." "$WS/"
node "$REPO/packages/preview-server/src/server.mjs" "$WS" --port "$HTTP" > "$WS/server.log" 2>&1 &
SPID=$!
trap 'kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; rm -rf "$WS"' EXIT
for _ in $(seq 1 120); do curl -s "http://127.0.0.1:$HTTP/" >/dev/null 2>&1 && break; sleep 1; done
node "$SCRIPT_DIR/probe-webui.mjs" "http://127.0.0.1:$HTTP/" "$OUT" "$LABEL"
