# evidence: footer-grid-fix（2026-07-18-transcript-footer-grid-fix / Wave 12）

F26（フッター流れ落ち）/ F27（「シークしました」不可視）の実環境根治の L1 実機検証記録。
`npm run build`（本番）→ `npm run package` の packaged app（`AKARI Video.app`）+ 生 CDP WebSocket
実操作で計測。playwright 不使用。

## 修正内容（採用方針）

`akari-transcript-widget.ts` の `init()` で、node の 4 直接子要素それぞれに **明示的 `gridRow`** を付与:
toolbar=`1` / notice=`2` / editorContainer=`3` / footer=`4`。`gridTemplateRows` の値・footer の 26px 固定・
notice の表示切り替え（`showNotice`/`hideNotice` の `display` トグル）は不変。

- **理由**: 根因は「notice が既定 `display:none` のとき CSS Grid が notice を**トラック割当てから除外**し、
  残る 3 子（toolbar / editorContainer / footer）が先頭 3 トラックへ詰め直され、editorContainer が
  2 番目の `auto` トラックで自然高さまで膨張して空間を全消費 → footer が縮退した `minmax(0,1fr)` トラックへ
  押し出され `overflow:hidden` でクリップされる」こと。各子に明示 `gridRow` を固定すると、notice が
  `display:none` でも editorContainer は 3 行目の `minmax(0,1fr)`、footer は 4 行目の `auto` に**留まり**、
  DOM 順序・表示状態への依存が構造的に断たれる。
- もう一方の案（notice を `height:0; overflow:hidden` で grid 参加のまま隠す）より、DOM 順序依存も同時に
  断てる明示配置を採用。notice の表示/非表示切り替え機能は退行なし（`display` トグルは温存）。

## フィクスチャ 2 種

- **fixture-owner-copy**: オーナー実プロジェクト（`test_1のコピー2`）を **cp -R で複製**したもの
  （オリジナルは不変更。複製先パスにも半角空白 + 日本語を含む）。実素材の混在配置
  （正典 `.akari/sidecars/<name>.analysis/analysis.json` + はぐれファイル群）をそのまま保持。
  別素材シーク検証用に 2 本目の合成動画を複製側にのみ追加。
- **fixture-canonical**: 正典配置のみの隔離フィクスチャ（`.akari/sidecars/<name>.analysis/analysis.json` +
  `project/captions.json` 6 行 + `project/edit.json`（`cuts:[{in:2.5,out:12}]` + 全 caption を覆う overlays）+
  合成動画 2 本）。パスに半角空白 + 日本語を含む。

いずれも検証専用でスクラッチ配下に作成し、本評価後に破棄。リポジトリには成果物（本ディレクトリ）のみ残す。

## 手法（前 Wave の抜け穴を塞ぐ）

前 Wave は「footer 自身の高さが 26px か」だけを測り、**footer が widget 可視域内にあるか**を測っていなかった。
本検証は毎回 `footer.getBoundingClientRect().bottom ≤ widget node の getBoundingClientRect().bottom` を実測する。

- 起動: `<App> <project> --remote-debugging-port=<port> --user-data-dir=<隔離> --no-sandbox`
- 操作: 生 CDP（`Runtime.evaluate`）で DI コンテナ（`window.theia.container`）から WidgetManager /
  ApplicationShell / CommandService / OpenerService / WorkspaceService を解決し、
  `akari.transcript.open` 実行・`OpenerService` でのプレビュー開閉・`requestSeek` 実呼び出し・
  注釈ストリップへの実クリック（`MouseEvent` dispatch）を行う。
- **修正前 / 修正後の対比**は同一 packaged app 内で実施: 4 子の明示 `gridRow` を**外す**と pre-fix の
  auto-placement を厳密に再現でき、戻すと解消する。差分は「gridRow 4 プロパティの有無」**のみ**で、
  overflow が 26px ⇄ 0px に反転することを実測（因果の分離）。

## 実測結果（両フィクスチャで同一の合否）

### (a) notice 既定非表示のまま footer.bottom ≤ widget.bottom

| 状態 | footer 高 | overflow(footer.bottom − widget.bottom) | footer 可視 | notice |
|---|---|---|---|---|
| 修正後（gridRow=1..4） | 26px | **0px** | **true** | none |
| 修正前 再現（gridRow 除去） | 26px | **+26px** | **false** | none |
| 修正 再適用 | 26px | **0px** | **true** | none |

→ 根因ノートの「常に 26px 超過」を修正前として再現し、修正で解消。`results.json` の
`after_fix_default` / `before_fix_reproduction` / `after_fix_restored` 参照。
スクリーンショット `01`（フッター文言が最下部に可視）と `02`（gridRow 除去でフッターが画面から消失）が対比。

### (b) シーク文言 3 分岐が画面に見えている

| 分岐 | 文言（実測） | 可視 |
|---|---|---|
| プレビュー無し | `00:00:13.880 を選択しました。プレビューを開くとここからジャンプできます。` | true |
| 一致（seeked） | `00:00:08.280 にプレビューをシークしました。` | true |
| 別素材（mismatched） | `00:00:22.640 を選択しました。別の素材のプレビューが開いています。` | true |

スクリーンショット `03` / `04` / `05`。3 分岐ともフッターに表示され可視。

### (c) フィクスチャ 2 種

上記 (a)(b) を fixture-owner-copy / fixture-canonical の両方で実施し、いずれも同一結果。各 `results.json` 参照。

### (d) リサイズ / 俯瞰タブ同時開き / アプリ再起動でも (a) 維持

- リサイズ（760×620 / 1180×900 / 900×1000 の 3 ビューポート）: いずれも overflow=0 / footer 可視（`results.json` `resize`）。
- 俯瞰（注釈）タブ同時開き: transcript を前面に戻すと overflow=0 / footer 可視（`transcript_with_overview_open` / `transcript_after_overview`）。
- アプリ再起動: 同一 user-data-dir で再起動すると transcript タブが**自動復元**（`autoRestored:true`）され、
  overflow=0 / footer 可視 / gridRow=1..4 保持（`restart.json`、スクリーンショット `11`）。

### (e) notice を意図的に表示させてもレイアウトが崩れない

notice を `display:block` + 文言セットした状態で、notice 可視 + editor 可視 + footer 可視・overflow=0 を同時成立
（`results.json` `notice_visible`、スクリーンショット `06`）。notice を戻すと既定状態に復帰。

### (f) 非退行

- 文字起こしパネル表示: captions 6 行ロード・Monaco 生成を確認。
- 1 行 diff + edited 保護: 3 行目（`c-0003`）のみを Monaco で編集 → `captions.json` は該当行のみ本文変更 +
  `edited:true`、他行の `edited` フラグは不変（`edit_protection`）。保存フッター「この行の変更を保存しました。」可視
  （スクリーンショット `10`）。
- カット装飾（fixture-canonical）: `cuts:[{in:2.5,out:12}]` に対し keep 範囲外の行 `[4,5,6]` にのみ
  `akari-transcript-cut` 系装飾（`decorations.cutDecoratedLines`）。
- akari-annotations ストリップクリックシーク: 注釈ウィジェットのストリップを実クリック → 自ウィジェットの
  フッターに `… を選択しました。…` が表示され可視（`annotations_strip_seek`、スクリーンショット `09`）。
  ※ 本タスクの修正は akari-transcript の 4 子への `gridRow` 付与のみで、akari-annotations には未介入。

## ファイル

- `fixture-owner-copy/` … オーナー実プロジェクト複製での実測（`results.json` / `restart.json` + スクリーンショット `01`–`11`）
- `fixture-canonical/` … 隔離正典フィクスチャでの実測（`results.json` / `restart.json` + 主要スクリーンショット）
