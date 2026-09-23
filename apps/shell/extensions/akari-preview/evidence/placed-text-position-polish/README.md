# 置いた文字の残課題 3 点 — 実機 L1 の証跡

タスク: `task/2026-09-23-placed-text-position-polish`（置いた直後の位置が中央でない / 右端で行の幅が縮む / 再読込中に字幕が一時的に消える）。

実機: 専用の CDP ポート 9457・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前に `placed-text-position-polish` を含む）。出力 1280×720、プレビュー上のフレーム幅 676px。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture（話した言葉 8 行・3 行目は長い行 + 旧来の置き方 `mc` / `x 0.5` / `y 0.5` の置いた文字 3 本。16 秒以降は置いた文字なし）。映像は ffmpeg |
| `scripts/l1.mjs` | L1 本体（`before` = 記録のみ / `after` = 判定つき） |
| `scripts/export-frame.mjs` | (a) の保存値そのままの置いた文字 1 本だけの 3 秒の案件を render-cut で書き出し、1.5 秒のフレームで明るい画素（文字）の外接矩形の中心を測る |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` | 既存の L1 証跡（placed-text-feedback-polish）の写し |
| `results-before.json` / `results-after.json` | 実測値 |
| `export-before.json` / `export-after.json` | 書き出しフレームの実測値 |
| `before-*.png` / `after-*.png` | スクリーンショット（07 は書き出しフレーム） |

## BEFORE（変更前のビルド）

| 所見 | 実測 |
|---|---|
| (a) 既定で置いた文字 | 保存値 `text_anchor: mc`・`position {x: 0.5, y: 0.5}`。プレートの**左端 0.5000**・中心 (0.6159, 0.5000)。書き出しフレームでも文字の中心 x **0.6156**（左端 0.5148）→ 再現 |
| (b) 右端で幅が縮む | 旧来の `mc` の行: 行の幅 133.59px（中央）→ 右寄り 0.7 で 133.59 → **右端 0.86 で 123.64** → はみ出す位置 0.97 で **50.69**（行数は常に 1）。既定で置いた文字も 156.73 → 右端 0.9 で **109.40** → 再現 |
| (b) 原因 | `.akari-caption__plate` が `position: absolute` で `left = x × 出力幅`・`right = 51.1953px`（固定）→ 右へ寄るほどプレートの幅（出力幅 − left − right）が縮む。`.akari-caption__line` は `white-space: pre`・`max-width: 92%` なので、プレート幅の 92% で行が切り詰められる（右端 0.86: プレート 134.39px × 0.92 = 123.64px）。折り返しではない |
| (c) 再読込中の一時消失 | アプリ内のドラッグ 10 回連続: 最小 2 本（消えない）。captions.json を「前半を書いて 120ms おいて後半を書く」外部書き込み 10 回連続: **最小 0 本・0 本の区間 10 回（240 / 137 / 152 / 136 / 137 / 145 / 184 / 138 / 132 / 140 ms）**、警告 `[akari-preview] failed to load …; hiding captions SyntaxError: Unterminated string in JSON` が 10 件 → 再現 |

BEFORE の走行では、スクリプトの 2 回目の起動（再読込後の確認）がシーク先の誤りで落ちた（`p1 plate not reached`。スクリプトを直したのは AFTER の前）。再読込後の確認は変更前の挙動の記録に必要ないので BEFORE では取り直していない。

## AFTER（最終ビルド・10/10 pass）

| 受け入れ条件 | 実測 |
|---|---|
| (a) 既定で置いた文字のプレート中心が横 0.5 ± 0.01・縦は中央付近 | 保存値 `text_anchor: tc`・`position {y: 0.4625}`（x なし = 横は中央揃え）。プレート中心 **(0.5000, 0.5042)**、左端 0.3841 |
| (a) ドラッグ → 落とした位置（±1%）で保存・描画 | (0.3, 0.3) / (0.7, 0.75) / (0.9, 0.5) / (0.62, 0.35) の 4 回とも描画の誤差 **0 / 0**、`text_anchor` は `tc` のまま（保存値は `{x: 左端, y: 上端}`。例 (0.62, 0.35) → `{x: 0.5041, y: 0.3083}`） |
| (a) 再読込後も同じ | Electron を起動し直して描画 **(0.62, 0.35)**・誤差 0 / 0 |
| (a) 書き出したフレームで中央 | render-cut（GPU 経路・verify pass）のフレームで文字の中心 **(0.4996, 0.5049)**（BEFORE 0.6156） |
| (b) 右端へドラッグしても幅が変わらない（±1px） | 旧来の `mc` の行: 0.4 / 0.7 / 0.86 / 0.97 の 4 か所とも **133.59px**・1 行。既定で置いた文字: 右端 0.9 で **156.73px**（元 156.73）。0.97 へ落とした文字は右端がフレーム幅の 1.0688 まではみ出したまま（はみ出し防止 OFF のまま） |
| (b) 話した言葉の字幕の折り返しは従来どおり | 短い行 336.75×31.7px・長い行 275.34×31.7px、`max-width: 92%`・`white-space: pre` とも BEFORE と一致（差 0px） |
| (c) 書き込み 10 回連続で字幕が 0 本になる瞬間が無い | webview 内で 4ms 間隔 + 毎フレーム DOM をポーリング。アプリ内のドラッグ 10 回: 8021 サンプル・最小 **2** 本。書き込み途中を挟む外部書き込み 10 回: 2142 サンプル・最小 **2** 本・0 本 0 回（警告は `…; keeping previous captions` に変わる） |
| (c) 直前の字幕に張り付かない | 書き込みが落ち着いた後、最後の書き込みの文言「蒸らしは 30 秒くらい (10)」がそのまま描かれる |

## 再現手順

```sh
node scripts/gen-fixture.mjs            # 既定の出力先は OS の一時ディレクトリ
node scripts/l1.mjs before|after        # 変更前 / 変更後のビルドで
node scripts/export-frame.mjs before|after
```

`export-frame.mjs` は render-cut の OSR / GPU 用に npm の electron を解決できる配置が必要（開発リポジトリではインストール済みアプリは候補から外れる）。
