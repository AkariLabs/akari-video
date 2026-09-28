#!/bin/bash
# subset.sh <name> <ids comma> : legacy から字幕を絞った GPU 書き出し
set -e
cd <work>
export AKARI_HOME=$PWD/fx/akari-home-caption-export-fonts AKARI_EXPORT_ALLOW_DESKTOP=0
R=<repo>
src=${SRC:-legacy}
rm -rf fx/sub-$1; mkdir -p fx/sub-$1; (cd fx/$src && git archive HEAD) | tar -x -C fx/sub-$1
python3 - "$1" "$2" <<'PY'
import json,sys
p=f'<work>/fx/sub-{sys.argv[1]}/captions.json'; ids=sys.argv[2].split(',')
d=json.load(open(p)); d['captions']=[c for c in d['captions'] if c['id'] in ids]; json.dump(d,open(p,'w'),ensure_ascii=False,indent=2)
PY
node $R/packages/edit-lint/bin/edit-lint.mjs fx/sub-$1 >/dev/null 2>&1 || true
node $R/packages/render-cut/bin/render-cut.mjs fx/sub-$1 --engine ${ENGINE:-gpu} --out exports/out.mp4 --no-verify-blank 2>&1 | tail -1
