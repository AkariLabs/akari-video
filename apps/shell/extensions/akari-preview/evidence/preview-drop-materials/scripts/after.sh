#!/bin/bash
# AFTER の一式（最終ビルド）。使い方: bash after.sh <repo> <work>
set -uo pipefail
REPO=$1; W=$2; HERE=$(cd "$(dirname "$0")" && pwd); A="$HERE/../after"; cd "$HERE"
bash setup.sh "$REPO" "$W" ws-a 3 | tail -1; P=$W/ws-a
# (a) プロジェクトの素材
node drag.mjs $P material:assets/clip-yellow.mp4 stage:0.75,0.25 $A/a1-material-video.json --mode=mouse --shot=$A/a1-material-video-drag.png --hold=$A/e0-material-hold-over-project.png >/dev/null
node drag.mjs $P material:assets/photo-orange.png stage:0.25,0.75 $A/a2-material-image.json --mode=mouse --shot=$A/a2-material-image-drag.png >/dev/null
node drag.mjs $P material:assets/tone-440.m4a stage:0.5,0.5 $A/a3-material-audio.json --mode=mouse --shot=$A/a3-material-audio-drag.png >/dev/null
# (b) ライブラリ
node click.mjs --text ライブラリ >/dev/null; sleep 2; node seek.mjs $P 4 >/dev/null
node drag.mjs $P "css:[data-akari-library-primary-tile=text]" stage:0.3,0.3 $A/b1-text.json --mode=mouse --shot=$A/b1-text-drag.png --hold=$A/e1-text-hold-over-library.png >/dev/null
node openlook.mjs >/dev/null; node drag.mjs $P textstyle:subtitle-news stage:0.5,0.4 $A/b2-textstyle.json --mode=mouse --shot=$A/b2-textstyle-drag.png >/dev/null
node opencat.mjs shapes >/dev/null; node drag.mjs $P shape:star-5 stage:0.75,0.3 $A/b3-shape.json --mode=mouse --shot=$A/b3-shape-drag.png --hold=$A/e3-shape-hold-over-library.png >/dev/null
node opencat.mjs image >/dev/null; node drag.mjs $P asset:still/bg-aurora-mesh stage:0.25,0.3 $A/b4-photo.json --mode=mouse --shot=$A/b4-photo-drag.png --hold=$A/e4-photo-hold-over-library.png >/dev/null
node opencat.mjs broll >/dev/null; node drag.mjs $P asset:broll/talkinghead-desk-ja-01 stage:0.6,0.7 $A/b5-broll.json --mode=mouse --shot=$A/b5-broll-drag.png >/dev/null
node opencat.mjs bgm >/dev/null; node drag.mjs $P asset:audio/bgm-beatslide-124-001 stage:0.5,0.5 $A/b6-bgm.json --mode=mouse --shot=$A/b6-bgm-drag.png >/dev/null
node opencat.mjs overlay >/dev/null; node drag.mjs $P asset:overlay/browser-mock stage:0.4,0.6 $A/b7-overlay.json --mode=mouse --shot=$A/b7-overlay-drag.png >/dev/null
node seek.mjs $P 5 >/dev/null; node key.mjs Escape >/dev/null 2>&1; node stageshot.mjs $P $A/f1-stage-5s.png >/dev/null; node plates2.mjs 1280 720 > $A/b12-plates-5s.json
# (c) 出力の枠の外
node seek.mjs $P 6 >/dev/null; node click.mjs --text "← ライブラリ" >/dev/null; sleep 1
node drag.mjs $P "css:[data-akari-library-primary-tile=text]" stage:-0.12,0.5 $A/c1-text-blackband.json --mode=mouse --shot=$A/c1-text-blackband-drag.png >/dev/null
node opencat.mjs image >/dev/null; node drag.mjs $P asset:still/bg-aurora-mesh stage:0.5,1.12 $A/c2-photo-transport.json --mode=mouse --shot=$A/c2-photo-transport-drag.png >/dev/null
node opencat.mjs shapes >/dev/null; node drag.mjs $P shape:star-5 stage:1.1,0.3 $A/c3-shape-blackband.json --mode=mouse --shot=$A/c3-shape-blackband-drag.png >/dev/null
node sum.mjs $A/a1-material-video.json $A/a2-material-image.json $A/a3-material-audio.json $A/b1-text.json $A/b2-textstyle.json $A/b3-shape.json $A/b4-photo.json $A/b5-broll.json $A/b6-bgm.json $A/b7-overlay.json $A/c1-text-blackband.json $A/c2-photo-transport.json $A/c3-shape-blackband.json > $A/summary-abc.jsonl
bash stop.sh "$W" ws-a
