# evidence — caption-group-drag（字幕グループ一括ドラッグ / ゾーンのインスペクター格下げ）

L1 = 実 Electron（production build）+ 生 CDP。`scripts/` はラッパーが書いた検証スクリプト
（テストフレームワークは使わない。`evidence/hit-region-pointer-events/scripts/` と同じ流儀）。

## 再現

```sh
# L1（shell 実機・39 検査）
AKARI_REPO=<repo> \
AKARI_FIXTURE=<internal issue-35 caption-anchor-bottom fixture dir> \
AKARI_OUT=<out> AKARI_CDP_PORT=9656 \
bash scripts/run-l1.sh after

# 書き出し（OSR tier 2 = リポジトリ同梱の npm electron・soft プロファイル）
node scripts/run-osr-tier2.mjs <repo> <project> <out.mp4>
```

`scripts/prepare-fixture.mjs` が issue #35 の fixture（cue 2 本 + `default_text_style` =
bc + position.y）を 4 秒の H.264 クリップへ複製し、「グループから出した行」の回帰用に
HTML オーバーレイ 1 枚（`extracted-line`）を足す。

## 中身

| パス | 内容 |
|---|---|
| `l1-shell/run-log.json` | L1 の全記録（39 PASS / 0 FAIL）。各検査の実測値つき |
| `l1-shell/after-*.png` | 各フェーズのウィンドウ全体スクリーンショット |
| `l1-shell/captions-final.json` | 最終フェーズ終了時点の captions.json |
| `capture-osr/sha256.json` | BEFORE / AFTER の osr フレーム PNG sha256（一致）+ 逆対照 |
| `capture-osr/after-osr-t1.0.png` | 比較に使ったフレームの実体 |

## L1 の実測（1600x1100 ビューポート・出力 1920x1080・stage 821x461.8）

| 検査 | 実測 |
|---|---|
| 選択の見え方 | `#caption-select-box` がプレート実寸に一致（ratio left 0.3821 / top 0.8377 / width 0.2357）+ バッジ「字幕グループ — 動かすと全字幕が動く」 |
| 下段着地 | `{text_anchor: "bc", position: {x: 0.5821, y: 0.8}}`・再読込後の描画 bottom 0.8000 / left 0.5821 |
| 別時刻の cue | cue1 bottom 0.8000 と cue2 bottom 0.8000 が一致（グループ一括） |
| 中央 + 下段 7% 吸着 | `{text_anchor: "bc", position: {y: 0.93}}`（x を書かない）・描画 bottom 0.930 / centerX 0.500 |
| 上 1/3 着地 | `{text_anchor: "tc", position: {y: 0.2}}`・描画 top 0.200 |
| 決定論 | 同じ着地座標の 2 回目が 1 回目と同一バイト |
| ゾーン hover | 実インスペクターのセル（9 個）へ mouseenter → プレビューの該当 1/3 が薄青（left 0 / top 0.6667 / 1/3 角）・mouseleave で消える |
| ゾーン click | `{zone: "top-right"}` が書かれ position / text_anchor が消える・描画が右上へ・セルに「保存中」 |
| 回帰 | 「出した行」オーバーレイの transform ドラッグは従来どおり効き、captions.json を変えない |
