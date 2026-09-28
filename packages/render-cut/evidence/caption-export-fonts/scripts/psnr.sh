#!/bin/bash
# psnr.sh <dirA> <dirB> : 各 cue の字幕帯（960x140 @ 160,545）の PSNR（参考値）
for i in $(seq -w 1 18); do a=$1/cue-$i.png; b=$2/cue-$i.png; if [ -f $a ] && [ -f $b ]; then
v=$(ffmpeg -hide_banner -i $a -i $b -lavfi "[0:v]crop=960:140:160:545[a];[1:v]crop=960:140:160:545[b];[a][b]psnr" -f null - 2>&1 | grep -o "average:[0-9.inf]*" | cut -d: -f2); echo "$i $v"; else echo "$i -"; fi; done
