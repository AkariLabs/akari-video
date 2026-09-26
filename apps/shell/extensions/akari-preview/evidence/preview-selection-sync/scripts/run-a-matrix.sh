#!/bin/bash
# (a) の組み合わせを順に回し、要約を 1 行ずつ出す。使い方: bash run-a-matrix.sh <outDir 名 before|after>
W=${PSS_WORK:?PSS_WORK に作業ディレクトリ（実パス）を指定}; OUT=$W/$1; P=$W/fixture/sel; export CDP_PORT=9624; cd $W/scripts; mkdir -p $OUT
for combo in caption:photo caption:shape caption:caption caption:placed caption:html placed:photo shape:photo photo:shape html:photo shape:caption photo:placed; do
  m=${combo%%:*}; c=${combo##*:}; git -C $P checkout -q -- . ; git -C $P clean -fdq; sleep 3
  node scenario-a.mjs $P $m $c $OUT a-$m-$c > $OUT/a-$m-$c.log 2>&1
  node -e 'const j=require(process.argv[1]);const s=j.steps;const a=s[2],b=s[3];console.log(j.label.padEnd(20),"seek6:",JSON.stringify({cap:a.closure.selectedCaptionId,ov:a.closure.requestedOverlayId,layer:a.closure.selectedLayerId,ix:a.ix.selectedId,tl:a.timeline.selected}),"\n    click:",JSON.stringify({cap:b.closure.selectedCaptionId,ov:b.closure.requestedOverlayId,layer:b.closure.selectedLayerId,ix:b.ix.selectedId,dom:[b.dom.captionSelectBox?.active,b.dom.layerSelectBox?.active,b.dom.overlaySelected],tl:b.timeline.selected}),b.log.filter(l=>l.kind.startsWith("out")).map(l=>l.kind.slice(10)+JSON.stringify(l.detail)).join(","))' $OUT/a-$m-$c.json 2>/dev/null || { echo "a-$m-$c FAILED"; tail -3 $OUT/a-$m-$c.log; }
done
echo MATRIX-DONE
