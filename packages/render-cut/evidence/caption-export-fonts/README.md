# caption-export-fonts の証跡（2026-09-28）

字幕の `text_style.font_family` / `font_weight` だけを変えた 18 行（1 行 = 1 書体・1 秒）のプロジェクトで、
プレビュー（アプリ実機）・OSR・GPU の同じ時刻（各行の中央 = i + 0.5 秒）を並べた比較。
OSR / GPU は `AKARI_EXPORT_ALLOW_DESKTOP=0`（worktree の npm electron = launcher_tier 2）で書き出した。

| 行 | 内容 |
|---|---|
| 01 | font_family なし（既定） |
| 02–15 | 同梱 9 家族（Noto Sans JP 400/900・Noto Serif JP 400/900・M PLUS Rounded 1c 500/900・BIZ UDGothic 400/700・Dela Gothic One・Zen Maru Gothic 400/700・Shippori Mincho・DotGothic16・Klee One） |
| 16 | ライブラリの書体（専用の AKARI_HOME の `assets/font/probe-hand/` に置いた検証用の素材「Probe Hand（検証用）」。中身は同梱の Dela Gothic One の複製） |
| 17 | 無い書体（`Nonexistent Font`）— 書き出しは警告、GPU は OSR に回る（`--engine gpu` の明示は理由つきで拒否） |
| 18 | `style_preset: narration-caption`（font_family `'Noto Serif JP', serif`） |

## 画像

- `before-osr-gpu-18cues.jpg` — 基点 `1a3a015f5`。legacy（display_policy なし）/ resolved（display_policy あり）の OSR・GPU。
  書体は全部 OS のフォントに落ちている。legacy の GPU はフォントスタックの行（18）があると `[object Object]` で落ちて出力なし
- `after-preview-osr-gpu-18cues.jpg` — 修正後。プレビュー（アプリ）/ OSR / GPU × 2 経路。GPU の列の右下は OSR との PSNR（字幕帯・参考値）。
  プレビューの列は GPU 用の fixture（17 行目を除いたもの）を開いて撮ったので 17 行目は空
- `after-font-panel-then-export.jpg` — アプリのフォントのパネルで c-0001 に Zen Maru Gothic の 700 を選んだ直後のプレビューと、その project の OSR / GPU 書き出し
- `after-narration-caption-sample-vs-export.jpg` — 編集パネルのスタイルの見本カード「ナレーション字幕」、そのカードを当てた後のプレビュー、OSR / GPU 書き出し
- `app-panel-0*.jpg` / `app-narration-*.{jpg,png}` — 上 2 つの操作の実機スクリーンショット

## データ

- `data/before-osr-dom-*.json` / `data/after-osr-dom-*.json` — OSR のページ（page-builder + static-server の実物）を Electron で開いた探針の記録
  （各字幕の computed font-family / `document.fonts.load` の結果 / `document.fonts` の状態 / 失敗したリクエスト / コンソール）
- `data/psnr-osr-vs-gpu.txt` — 字幕帯（960×140）の OSR↔GPU PSNR（左 = legacy・右 = resolved）
- `data/bytes-no-font-family-{base,after}.json` — font_family を持たない 5 通りの captions.json で、字幕 overlay・OSR のページ HTML・overlay sheet の SHA-256（repo root を正規化）。基点と一致
- `data/preview-l1-*.json` / `data/app-*.json` — アプリ実機の記録（webview の `document.fonts`・字幕の computed font・captions.json への書き込み）

## 再現

`scripts/` は検証専用（`<repo>` = リポジトリ、`<work>` = 作業用一時ディレクトリに読み替える）。
`gen-fixture.mjs` → `export-all.sh` / `export-gpu.sh` → `frames.sh` → `sheet-electron.mjs`、DOM は `probe-osr-dom.mjs`、
アプリは `app-preview-l1.mjs` / `app-panel-l1.mjs` / `app-narration-l1.mjs`（CDP ポート 9640・専用の `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`）。
