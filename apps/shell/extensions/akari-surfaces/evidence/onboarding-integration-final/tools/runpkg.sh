#!/bin/bash
# usage: runpkg.sh <wt> <label> <pkg>
export PATH="$HOME/.local/node:$PATH"
WT=$1; L=$2; P=$3
OUT=C:/t/oif/l0/$L; mkdir -p $OUT C:/t/oif/tmp-$L
export TMP="C:\t\oif\tmp-$L" TEMP="C:\t\oif\tmp-$L" NO_COLOR=1 FORCE_COLOR=0
unset ELECTRON_RUN_AS_NODE
start=$(date +%s)
case $P in
  render-cut) cd $WT/packages/render-cut && node --test --test-reporter=spec --test-concurrency=1 test/*.test.mjs ;;
  gpu-export|osr-export) cd $WT/packages/$P && node --test --test-reporter=spec test/*.test.mjs ;;
  preview-server) cd $WT/packages/preview-server && npm run pretest >/dev/null 2>&1; echo "pretest=$?"; node --test --test-reporter=spec test/*.test.mjs ;;
  akari-preview) cd $WT/apps/shell/extensions/akari-preview && npx tsc -b && node --test --test-reporter=spec test/*.test.mjs ;;
  akari-annotations) cd $WT/apps/shell/extensions/akari-annotations && npx tsc -b && node --test --test-reporter=spec $(ls test/*.test.mjs | grep -v ai-still-routes) ;;
  akari-surfaces) cd $WT/apps/shell/extensions/akari-surfaces && npx tsc -b && node --test --test-reporter=spec src/common/*.test.mjs src/node/*.test.mjs $(ls test/*.test.mjs 2>/dev/null) ;;
esac > $OUT/$P.log 2>&1
echo "exit=$? secs=$(( $(date +%s) - start ))" >> $OUT/$P.log
# summary
{ grep -aE "^ℹ (tests|pass|fail|skipped|cancelled)" $OUT/$P.log; awk '/^✖ failing tests:/{f=1;next} f && /^✖ /{sub(/ \([0-9.]+m?s\)$/,"");print}' $OUT/$P.log | sort -u; } > $OUT/$P.sum
echo "$L $P done $(head -3 $OUT/$P.sum | tr '\n' ' ')"
