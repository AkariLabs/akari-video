# 証跡: 書き出しポップアップに「どのエンジンで書き出すか・なぜ GPU で書き出せないか」と書き出せない理由を出す（2026-10-06）

検証はラッパーが実施（実機 = 自分専用の CDP ポート 9477・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace）。
スクショ・計測 JSON はリポの外に置き、ここには再現用のスクリプトと要約だけを残す。

## スクリプト（`scripts/`）

| ファイル | 用途 |
|---|---|
| `cdp-lib.mjs` / `l1-lib.mjs` | `akari-annotations/evidence/place-text-button/scripts/` の写し（CDP・Electron 起動）。`l1-lib.mjs` だけ、背面に隠れた窓で `requestAnimationFrame` が止まりシェルの組み立てが進まない件への対処として `--disable-background-timer-throttling` / `--disable-backgrounding-occluded-windows` / `--disable-renderer-backgrounding` を足した |
| `gen-fixture.mjs` | fixture 3 件（`osr` = 字幕 4 行のうち 2 行が登場 `glitch`・1 行が `stroke_inner` / `gpu` = 動きも装飾も無い字幕 4 行 / `lint` = 映像の参照先 `assets/missing.mp4` が無い）。映像は ffmpeg（L1 専用） |
| `l1.mjs` | メニュー →「書き出し…」→「書き出す」を実クリックし、ポップアップ下部の 1 行・一覧・コピー・完了画面・拒否表示を読む。`lint` は「lint を再実行」あり（シェルの lint で停止）と、外して render-cut 自身の拒否（`REFUSED` 行）の 2 本 |

```sh
node scripts/gen-fixture.mjs <fixture-root>
node scripts/l1.mjs <fixture-root> <out-dir> osr gpu lint
```

## 実測（本タスクのビルド）

| 受け入れ条件 | 実測 |
|---|---|
| glitch 2 件 + 縁取り内側 1 件 → 開始直後 | 「書き出す」押下から 1.6 秒（進捗 3%）で下部に「今回は OSR で書き出しています — 理由: 字幕 2 件の動き「グリッチ」、字幕 1 件の縁取り（内側）」 |
| クリックで一覧とコピー | 1 行目をクリックで一覧が開く: 「字幕 c-0001: 動き「グリッチ」（caption-motion-glitch-unsupported）」「字幕 c-0002: …」「字幕 c-0003: 縁取り（内側）（caption-rich-look-stroke_inner-unsupported）」。「コピー」でクリップボードに要約 + 3 行（`navigator.clipboard.readText()` で一致を確認）。一覧は `user-select: text` |
| 完了画面にも同じ 1 行 | 「書き出し完了」画面の下部に同じ 1 行・同じ一覧 |
| 動きの無い fixture | 進捗 8% の時点で「GPU で書き出しています」、完了画面も同文 |
| エンジン表示の二重化なし | ポップアップ内の `GPU` / `OSR` の出現は下部の 1 行の 1 回だけ（進行中・完了とも） |
| lint error（シェルの lint で停止） | ポップアップは閉じず、下部に「書き出せませんでした: sources[0].path does not resolve to a regular file」+「書き出す前に直すものがあります — 」「Lint を開く」 |
| lint error（「lint を再実行」を外して render-cut が拒否） | 副題「書き出しを停止しました」の画面で同じ 2 行（findings は `.akari/lint.json` から）。「Lint を開く」→ ポップアップが閉じて `edit-lint-report.html` が開く |
| CLI の行 | `render-cut <osr> --progress` の stdout に `ENGINE osr reasons=[…3 件…]`、stderr の `render-cut warning: GPU export is ineligible; using OSR: …` は従来どおり。`<gpu>` は `ENGINE gpu`。`.akari/render.json` の `provenance.engine` はそれぞれ `osr` / `gpu` |
| 拒否の exit code・文言 | lint 未 PASS で `--progress` あり / なしとも exit 1・stderr `render-cut refused: .akari/lint.json is missing or not PASS; …` が基点と一致。`REFUSED code=lint-not-pass detail={…}` は `--progress` のときだけ stdout に出る |
