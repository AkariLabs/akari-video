# フォント・スタイルのパネルの仕上げ 4 点 — 実機 L1 の証跡

タスク: `task/2026-09-27-caption-panels-followups`。

実機: 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。専用の CDP ポート 9633・一時ディレクトリの
`--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace（名前にタスクのスラッグを含む）。起動の cwd はリポ直下。
ウィンドウ 1440×900（`window.resizeTo`）・devicePixelRatio 2 で撮って 1440 幅へ縮小。操作は CDP の実マウス・実キーボード。
fixture は話した言葉 5 行（c-0001 だけ色・縁取り・座布団・影を変えてある）+ マイスタイル 1 件（`scripts/gen-fixture.mjs`）。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/before.mjs` | 手順 0（BEFORE・判定なし）。基点 `83afc351c` のビルドで実行 → `results-before.json` / `before-*.png` |
| `scripts/after.mjs` | AFTER（判定つき 16 項目）。最終ビルドで実行 → `results-after.json` / `after-*.png` |
| `scripts/probes.mjs` | 両方で使う観測式（プレビューの字幕の computed style・フォント一覧・「…」の中身・編集パネルのタブ / 欄の可視範囲・目立たせたクラスの記録） |
| `scripts/common.mjs` ほか | caption-type-panels の L1 部品の写し（既定ポート 9633） |
| `scripts/launch.mjs` / `attach.mjs` / `ev.mjs` | 調査用（起動したままにする・断片を実行・式を評価 / 撮影） |

## BEFORE（基点 `83afc351c`）— 手順 0

| 項目 | 記録 | 実測 |
|---|---|---|
| 1 ホバー（書体） | `before-1-hover-font.png` | 通知 `akari-caption-panel-preview {captionId:'c-0001', textStyle:{fontFamily:'Dela Gothic One'}}` は出るが、出力プレビューの c-0001 の computed style（書体・色・縁・座布団）は**不変** = 受け口が無い |
| 1 ホバー（スタイル） | `before-1-hover-style.png` | 通知（色・座布団の差分）は出るが、プレビューは不変 |
| 2 フォント名 | `before-2-font-names.png` | 9 行とも英字名（19px・その書体）。検索「明朝」「しっぽり」「ゴシック」は 0 件、「Shippori」だけ当たる |
| 3 「…」 | `before-3-overflow-open.png` | 畳まれた 6 項目がアイコンだけ（箇条書き「•☰」・間隔「↔」・縦書き「縦書」・透明度はアイコンのみ）。エフェクト / アニメーションは文字だけ |
| 4 エフェクト / アニメーション / 設定をもっと見る | `before-4-*.png` | 3 つとも `resolveCaptionRevealField` が `caption-effect` / `caption-animation` を知らず `caption-style` に落ち、**「文字」欄を光らせるだけ**（効果欄にも動きタブにも行かない）。フォント / スタイルパネルが開いているときは**何も起きない**（パネルのまま・光らない） |

## AFTER（最終ビルド）— 16/16 pass（65 秒）

| 受け入れ条件 | 記録 | 実測 |
|---|---|---|
| 2 日本語の表示名 + 英字名・両方で検索 | `after-2-font-names.png` / `after-2-font-search-mincho.png` | 9 行すべて読み込み済みのその書体・19px の日本語名 + 10px の英字名。しっぽり明朝 / BIZ UDゴシック / ドットゴシック16 / クレー One（ファイルの日本語 name）・Zen丸ゴシック（配布元の表記）・残り 4 書体は英字名 +「あ字」。検索: 明朝・しっぽり・Shippori → しっぽり明朝 / ゴシック → 3 件 / ドット・DotGothic → ドットゴシック16 / 丸 → Zen丸ゴシック |
| (a-1) 書体のホバー | `after-a1-font-hover.png` | プレビューの c-0001 が `Dela Gothic One` に（色・座布団は元のまま）・captions.json 不変 |
| (a-2) Esc | `after-a2-font-escape.png` | 元の見た目と完全一致・書き込みなし・パネルは開いたまま |
| (a-3) 離れる | `results-after.json` | しっぽり明朝のホバーで変わり、カーソルを外すと元に戻る |
| (a-4) クリックで確定 | `after-a4-font-click-commit.png` | 書き込み 1 回（変わったキーは `font_family` だけ・他の字幕は不変）。**確定の前後 234 フレームすべて Dela Gothic One**（元の書体に戻るフレーム 0 = ちらつかない） |
| (a-5) undo | `after-a5-font-undo.png` | Cmd+Z 1 回で captions.json が fixture と byte 一致・プレビューも元の見た目 |
| (c) 太さのホバー | `after-c-weight-hover.png` | BIZ UDゴシック 400 → プレビューが `BIZ UDGothic` / 400 に・書き込みなし・離れると戻る |
| (b) スタイルのホバー | `after-b-style-hover.png` | ニュース風 → 文字色が白・座布団が赤（`rgb(198,40,40)`）に・書き込みなし・離れると戻る |
| 解除 | `results-after.json` | ホバー中に `akari.captionPanel.close` → 元に戻る / ホバー中に別の字幕を選ぶ → 一時スタイルが外れる（c-0001 を選び直すと元の見た目） |
| 3 「…」の中 | `after-3-overflow-open.png` / `after-3-overflow-pressed.png` | 6 項目すべて「アイコン（25px 枠・はみ出しなし）+ 名前（省略なし）」。箇条書きをオンにすると ✓ と強調色、他は印なし。書き込みは undo 1 回で元どおり |
| 4 エフェクト | `after-4-effect.png` / `after-4-effect-from-font-panel.png` | テキストタブ・「効果」欄（開いた状態）が表示範囲に全高 206px・目立たせ（reveal-flash）あり。フォントパネルが開いていても閉じて移る |
| 4 アニメーション | `after-4-animation*.png` | 動きタブ・字幕の袋のアニメーターの欄が表示範囲に・目立たせあり（パネルからも同じ） |
| 4 設定をもっと見る | `after-4-more-settings*.png` | テキストタブ・「文字」欄が表示範囲に・目立たせあり（パネルからも同じ） |

## 判定側の注記

- 太さのホバーは BIZ UDゴシックで確認した。M PLUS Rounded 1c は、確定済みの字幕でもプレビューで system フォントになる既存の不具合がある
  （edit-store が `--caption-font-family: M PLUS Rounded 1c` を引用符なしで出し、`1c` が CSS の数値として解釈され宣言ごと無効になる）。本票の境界外
