#!/bin/bash
# render-cut --engine gpu を 1 構成ずつ実走し、gpu-run.json と出力 mp4 を results/<label>/ へ集める。
#   BENCH=<検証ディレクトリ> TREE=<render-cut を叩くリポのルート> ./run-l1.sh <label> [configs...]
# - BENCH/<label>/<config>/ に edit.json + assets/ を置いておく（edit-lint PASS 済み）
# - AKARI_EXPORT_ALLOW_DESKTOP=0: インストール済みアプリ（tier 1）は同梱コードを使い、リポの変更が乗らない。
#   tier 2（node_modules の Electron + リポの electron-main.mjs / generated バンドル）で測るために desktop を外す
# - Electron は同時 1 本。終了後に node_modules/electron/dist を持つ残存プロセスを PID 指名で kill し 0 件を確認する
# - ビルド・実走の前に load average が 40 を下回るまで待つ
set -u
: "${BENCH:?}" "${TREE:?}"
LABEL=$1; shift
RES=${RESULT_LABEL:-$LABEL}
CONFIGS=${@:-"1080p-x1 1080p-pip 4k-x1-out1080 4k-pip-out1080 4k-x1-out4k 4k-pip-out4k 1080p-30s"}
mkdir -p "$BENCH/results/$RES"
cd "$TREE"
for c in $CONFIGS; do
  p=$BENCH/$LABEL/$c
  until [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -lt 40 ]; do sleep 15; done
  rm -rf "$p/.akari/gpu-run.json" "$p/exports/out.mp4" "$p/.akari/render-tmp"
  t0=$(date +%s.%N)
  AKARI_HOME=$BENCH/home AKARI_EXPORT_ALLOW_DESKTOP=0 node packages/render-cut/bin/render-cut.mjs "$p" --engine gpu --progress --out "$p/exports/out.mp4" > "$p/render.log" 2>&1
  rc=$?
  t1=$(date +%s.%N)
  for pid in $(ps -eo pid,args | grep -E "Electron|Helper" | grep "node_modules/electron/dist" | grep -v grep | awk '{print $1}'); do kill -9 "$pid" 2>/dev/null; done
  left=$(ps -eo pid,args | grep -E "Electron|Helper" | grep "node_modules/electron/dist" | grep -v grep | wc -l | tr -d ' ')
  wall=$(echo "$t1 - $t0" | bc)
  cp "$p/.akari/gpu-run.json" "$BENCH/results/$RES/$c.gpu-run.json" 2>/dev/null; cp "$p/exports/out.mp4" "$BENCH/results/$RES/$c.out.mp4" 2>/dev/null
  echo "$RES $c rc=$rc wall=${wall}s electron_left=$left load=$(sysctl -n vm.loadavg)"
  echo "{\"label\":\"$LABEL\",\"config\":\"$c\",\"rc\":$rc,\"wallSeconds\":$wall,\"electronLeft\":$left}" >> "$BENCH/results/$RES/wall.jsonl"
done
