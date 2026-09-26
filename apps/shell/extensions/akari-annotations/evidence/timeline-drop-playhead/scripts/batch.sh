#!/bin/bash
# 同じ置き方を N 回繰り返す（毎回 5 秒へシークし直してから落とす）: bash batch.sh <project> <outdir> <prefix> <row> <tSec> <card>...
set -uo pipefail
P=$1; OUT=$2; PFX=$3; ROW=$4; T=$5; shift 5; HERE=$(cd "$(dirname "$0")" && pwd); cd "$HERE"
mkdir -p "$OUT"; i=0
for card in "$@"; do
  i=$((i+1)); n=$(printf '%s%02d' "$PFX" $i)
  node seek.mjs "$P" 5 > /dev/null; sleep 2
  echo "$n $card $(node tldrag.mjs "$P" "$card" "$T" "$ROW" "$OUT/$n.json" --settle=${SETTLE:-15000})"
done
