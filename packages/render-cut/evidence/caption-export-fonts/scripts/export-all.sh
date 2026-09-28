#!/bin/bash
# export-all.sh <tag> : legacy / resolved の両 fixture を OSR・GPU で書き出す（edit.json は毎回 fixture の HEAD に戻す）
cd <work>
export AKARI_HOME=$PWD/fx/akari-home-caption-export-fonts AKARI_EXPORT_ALLOW_DESKTOP=0
R=<repo>
for p in legacy resolved; do
  (cd fx/$p && git checkout -q edit.json && rm -rf fx exports .akari/render.json .akari/gpu-run-failed.json)
  node $R/packages/edit-lint/bin/edit-lint.mjs fx/$p > logs-$1-$p-lint.txt 2>&1
  for e in osr gpu; do
    (cd fx/$p && git checkout -q edit.json)
    /usr/bin/time -p node $R/packages/render-cut/bin/render-cut.mjs fx/$p --engine $e --out exports/$1-$e.mp4 --no-verify-blank > logs-$1-$p-$e.txt 2>&1
    echo "$p $e exit=$? $(tail -4 logs-$1-$p-$e.txt | head -1)"
    cp fx/$p/.akari/render.json logs-$1-$p-$e.render.json 2>/dev/null
  done
done
