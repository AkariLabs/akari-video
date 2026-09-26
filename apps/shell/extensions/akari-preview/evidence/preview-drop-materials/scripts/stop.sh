#!/bin/bash
# 本票で起動した Electron だけを PID で止める。使い方: bash stop.sh <work> <ws名>
PID=$(cat "$1/pid-$2" 2>/dev/null) || exit 0
kill "$PID" 2>/dev/null; for i in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || exit 0; sleep 0.5; done; kill -9 "$PID" 2>/dev/null; exit 0
