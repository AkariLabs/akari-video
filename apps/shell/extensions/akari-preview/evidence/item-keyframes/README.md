# item keyframes L1 evidence

実 Electron の shell プレビューで、v2 HTML item の inline / motion 袋キーフレームを従来クロックと
frame-engine クロックの両方について検証する。`run-l1.mjs` は L1 (a)〜(f) を一続きで assert し、
各走の JSON と再生中の PNG 2 枚をこのディレクトリへ書く。

## 前提

- `apps/shell/node_modules/electron/dist/Electron.app` が存在すること
- `npm --prefix apps/shell run build:ext` が完了していること
- `ffmpeg` が `PATH` にあること
- macOS で実行すること（`caffeinate` を使用する）

## realpath の注意

macOS の `/tmp` は `/private/tmp` への symlink である。projectDir に `/tmp/...` を渡すと Theia の
workspace 境界判定と URI が食い違い、「ワークスペース外の動画はプレビューできません」になって
プレビューが空になる。fixture、isoDir、ログには必ず `/private/tmp/...` を使う。
`run-l1.mjs` と `prepare-fixture.mjs` もこの条件を assert する。

## 両クロックの実行

各 L1 走は edit.json を変更し、最後に `motion/s01.json` を削除するため、走るたびに fixture を作り直す。

```sh
EVIDENCE="$PWD/apps/shell/extensions/akari-preview/evidence/item-keyframes"

node "$EVIDENCE/prepare-fixture.mjs" /private/tmp/akari-ikf-legacy
LEGACY_PID=$("$EVIDENCE/launch-shell.sh" \
  /private/tmp/akari-ikf-legacy 9811 /private/tmp/akari-ikf-legacy-iso \
  /private/tmp/akari-ikf-legacy.log 0)
node "$EVIDENCE/run-l1.mjs" 9811 /private/tmp/akari-ikf-legacy "$EVIDENCE" legacy-clock
kill "$LEGACY_PID"

node "$EVIDENCE/prepare-fixture.mjs" /private/tmp/akari-ikf-frame
FRAME_PID=$("$EVIDENCE/launch-shell.sh" \
  /private/tmp/akari-ikf-frame 9812 /private/tmp/akari-ikf-frame-iso \
  /private/tmp/akari-ikf-frame.log 1)
node "$EVIDENCE/run-l1.mjs" 9812 /private/tmp/akari-ikf-frame "$EVIDENCE" frame-engine-clock
kill "$FRAME_PID"
```

`run-l1.mjs` は最後に CDP の `Browser.close` も送る。上の `kill` はプロセスが残った場合の後始末なので、
既に終了している場合の `No such process` は無視できる。

## HTML SHA-256 非退行

起点 `9387ad3e` は別ツリーへ展開する。比較器は現在ツリーと起点ツリーそれぞれの
`readPreviewInternalEdit` + `expandBagOverlays` で fieldtest を overlays 化し、同じ sentinel を
`runtimeJavaScript` に渡して補間器注入ブロックだけを比較対象から除外する。

```sh
BASE=/private/tmp/akari-ikf-base-9387ad3e
mkdir -p "$BASE"
git archive 9387ad3e | tar -x -C "$BASE"
node apps/shell/extensions/akari-preview/evidence/item-keyframes/compare-html-sha.cjs \
  "$BASE" apps/shell/extensions/akari-preview/evidence/item-keyframes/html-sha256.json
```

読み取り可能な環境では内部 fieldtest の次の 3 本を必ず比較結果へ含める。

- `2026-08-03-akari-video-pv`
- `2026-08-05-telop-html-board`
- `2026-08-11-tomosu-pv-remake`

fieldtest 全体が読めない環境では 3 個の合成ケースへフォールバックする。3 本の一部だけが読める場合は、
証跡の取りこぼしを防ぐため比較器を失敗させる。

## 結果ファイル

- `legacy-clock.json` / `frame-engine-clock.json`: `status: "PASS"` が通し結果。`observations` に
  1.1s / 2.4s の `--x`・opacity、再生時刻、edit / motion 更新前後、motion 袋削除時の warning を記録する
- `*-play-start.png` / `*-play-end.png`: 両クロック共通の出力時刻 `#seek` が 0.6 秒以上進み、
  `plain` の `--x` が変化した 2 時刻の実画面。`#preview-video` の状態はクロック依存なので参考値だけを記録する
- `html-sha256.json`: `fieldtests.used` が 3 本、各 `comparisons[].equal` が `true` なら非退行 PASS

失敗時も `<label>.json` を書き、`error` に assert または timeout の stack を残す。
