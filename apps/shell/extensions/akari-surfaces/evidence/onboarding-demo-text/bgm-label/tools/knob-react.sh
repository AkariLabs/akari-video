#!/usr/bin/env bash
# demo-bgm のツマミ 20 個を 1 つずつ振り、4 時刻（入り・拍の輪・静止・抜け）の絵が既定から変わるかを見る
# （内部リポ harness/knob-audit.mjs の「無反応」判定と同じく PNG のバイト一致で比べる）。
set -u
export PATH="$HOME/.local/node:$PATH"
F="$1"; OUT="$2"
T="0.05,0.3,0.567,3.3"
node C:/t/bgmlabel/tools/render-bgm.mjs "$F" "$OUT/default" --start 29.4333 --times $T --mode preview --transparent --prefix k >/dev/null
declare -a KNOBS=(
  "--bgm-left:700px" "--bgm-top:200px" "--bgm-width:220px" "--bgm-height:80px"
  "--bgm-radius:4px" "--bgm-tilt:8deg" "--bgm-gap:30px" "--bgm-font-size:40px"
  "--bgm-font:serif" "--demo-accent:#2255ff" "--bgm-ink:#000000" "--bgm-glow:rgba(0,0,255,.9)"
  "--demo-shadow:0 0 0 12px #00ff00" "--bgm-ring:#00ff00" "--bgm-lead:.2s" "--bgm-at-in:.5s"
  "--bgm-at-out:1s" "--bgm-out-y:400px" "--bgm-beat:.3s" "--bgm-beat-peak:.5s"
)
i=0
for kv in "${KNOBS[@]}"; do
  i=$((i+1))
  node C:/t/bgmlabel/tools/render-bgm.mjs "$F" "$OUT/k$i" --start 29.4333 --times $T --mode preview --transparent --prefix k --vars "$kv" >/dev/null
  changed=0
  for t in 0.050 0.300 0.567 3.300; do
    cmp -s "$OUT/default/k-t$t.png" "$OUT/k$i/k-t$t.png" || changed=$((changed+1))
  done
  echo "$kv changed_frames=$changed/4"
done
