#!/bin/bash
# export-gpu.sh <tag> : 無い書体の行を除いた fixture を GPU で、全行 fixture を --engine auto で書き出す
cd <work>
export AKARI_HOME=$PWD/fx/akari-home-caption-export-fonts AKARI_EXPORT_ALLOW_DESKTOP=0
R=<repo>
for p in legacy resolved; do
  (cd fx/$p-gpu && git checkout -q edit.json && rm -rf exports)
  node $R/packages/edit-lint/bin/edit-lint.mjs fx/$p-gpu > /dev/null 2>&1
  /usr/bin/time -p node $R/packages/render-cut/bin/render-cut.mjs fx/$p-gpu --engine gpu --out exports/$1-gpu.mp4 --no-verify-blank > logs-$1-$p-gpu.txt 2>&1
  echo "$p-gpu gpu exit=$? $(tail -4 logs-$1-$p-gpu.txt | head -1)"; cp fx/$p-gpu/.akari/render.json logs-$1-$p-gpu.render.json 2>/dev/null
  (cd fx/$p && git checkout -q edit.json)
  /usr/bin/time -p node $R/packages/render-cut/bin/render-cut.mjs fx/$p --engine auto --out exports/$1-auto.mp4 --no-verify-blank > logs-$1-$p-auto.txt 2>&1
  echo "$p auto exit=$? $(tail -4 logs-$1-$p-auto.txt | head -1)"; cp fx/$p/.akari/render.json logs-$1-$p-auto.render.json 2>/dev/null
done
