#!/bin/bash
set -euo pipefail
EVIDENCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec "${NODE_BIN:-node}" "$EVIDENCE_DIR/run-shell.mjs" "$@"
