# L1 検証サマリ — strip-and-annotations-v0

パッケージ版 `AKARI Video.app`（`npm run package` 実成果物、asar 検証 GREEN・457MB）を
`--remote-debugging-port` + 隔離 `--user-data-dir` で起動し、生 CDP WebSocket クライアントで
実 DOM への実クリック（`Input.dispatchMouseEvent`）・実文字入力（`Input.insertText`）を行った。
フィクスチャは `<PROJECT_ROOT>`（パスに半角スペース + 日本語ディレクトリ名を含む）配下に作成し、
実 ffmpeg 合成動画（10秒 testsrc）・`.akari/sidecars/sample.mp4.analysis/analysis.json`
（`source: "../../../assets/sample.mp4"`、正典の相対トラバーサル形式）・`project/edit.json`
（`cuts: [{in:3,out:7}]`）・`project/captions.json`（3件、cut/keep 境界をまたぐ配置）・
own-root な git リポジトリ（`git init` 済み）を用意した。

widget/service の解決は Theia の DI コンテナ（`window.theia.container._bindingDictionary`）を
CDP 経由で走査し、対象クラスに固有のメソッド名の組み合わせ（フィンガープリント）で一意特定した
（本番ビルドはクラス名が minify されるため、`AkariAnnotationsContribution` なら
`locate`/`findFirstCanonicalAnalysis`/`watchForReview` の3メソッド、`PartnerSessionService` なら
`observeTerminal`/`useTerminal`/`scheduleFlush` の3メソッドを同時に持つインスタンスを
`getAll(Symbol(...))` の結果から検索。各ケースで候補1件のみに絞り込めることを確認済み）。
タブを開く操作はこの解決した `AkariAnnotationsContribution.open()`（コマンドパレット経由の
`akari.annotations.open` 実行と同一のコードパス）を直接呼び出す形で行い、ストリップのクリック・
コメント入力・追加ボタン・確認済みボタンのクリックは実際の座標に対する CDP `Input` イベントで行った。

## (a) ストリップが実データ（cuts + captions + 注釈）を表示する

- ウィジェットを開いた直後（注釈0件）: `cutCount=2`（`cuts:[{in:3,out:7}]` の外側区間 [0,3) と
  (7,10.2]）・`capCount=3`・`pinCount=0`・`totalDuration=10.2`（実測値、期待値と一致）
- 各セグメントの `left%`/`width%` を実測し、`in=3,out=7` に対し `cut1: left=0%,width=29.41%`
  （=3/10.2）・`cut2: left=68.63%,width=31.37%`（=(10.2-7)/10.2）と正しく一致することを確認
- 修正前は cut/caption セグメントに背景色が無く実機で視認できない不具合を発見（位置計算は
  正しかった）。`.akari-annotations-strip-cut`/`.akari-annotations-strip-caption` に背景色を
  追加する修正を実施し、`02-strip-real-data-empty.png` で視認確認（グレーのカット区間2本・
  紫の字幕ティック3本）
- `videoUri` は `analysisUri.parent.resolve(analysis.source).normalizePath()` で解決され、
  半角スペース + 日本語ディレクトリ名を含む実パスでも正しく `file://...%20...%E6%A4%9C...` の
  形（`..` を含まない正規化済み文字列）になることを実測確認（F27 と同じ地雷を踏んでいない）

## (b) 注釈をタイプで1件追加 → 1行着地（git diff 1行）→ auto-git コミット → ナッジ

- ストリップを実クリックして時刻選択 → コメント欄へ `Input.insertText` で日本語文字列を実入力 →
  「追加」ボタンを実クリック、を2回実施（1件目・2件目）
- 1件目（review.json 新規作成）: コミット `レビューコメントを追加`（`project/review.json` 6行 +
  `.akari/events/*.json` 8行 + `.akari/render-pins.json`）
- **2件目（既存ファイルへの追記）**: `git show --stat` で `project/review.json | 1 +` /
  `1 file changed, 1 insertion(+)` を実測 — 追記した注釈の行だけが追加され、直前の注釈の行・
  閉じ括弧行は一切書き換わらないこと（先頭カンマ配列フォーマット）を確認。3回目の検証走行
  （CSS/重複バグ修正後の再検証）でも同じく `1 insertion(+), 0 deletions(-)` を再実測
- 各コミットで `.akari/events/<timestamp>-annotation-created-*.json` が同時にステージされている
  ことを `git show --stat` で確認（イベント書き込みと review.json 書き込みが同一コミットに乗る）
- **ナッジ**: `PartnerSessionService`（未編集・既存コード）を CDP でフィンガープリント解決し、
  `.queue` を直読みしたところ、`akari-partner` 種別の PTY が1つも無い状態でも
  「`project/review.json が更新されました。内容を確認し、次の一手を進めてください。`」が
  自動的にキューされていることを実測（イベントファイル書き込みだけで既存の file-watch 経路が
  反応することの証跡）。モック端末（`kind:'akari-partner'`、`sendText` を実測用にラップ）を
  `useTerminal()` で実際に接続すると、500ms 以内にキュー2件がそのまま `sendText()` へ
  フラッシュされ、`queue.length` が 0 に戻ることを確認

## (c) 注釈の状態遷移を1周

- 人間の操作（open 作成・addressed→resolved の確認）は UI 経由、AI 応答（open→addressed +
  response 書き込み）は契約どおり「AI のみが書く」ため本検証ではファイル直接書き換えで模擬した
- 模擬した AI 応答書き込み後、ファイル監視のみで（アプリを操作せず）1〜2秒でウィジェットの
  一覧・ストリップのピン色（青→オレンジ）・「確認済みにする」ボタンの出現が反映されることを実測
- 「確認済みにする」ボタンを実クリック → `status` が `resolved` に変化、ボタンが消滅、
  ピン色が緑に変化（`04-status-lifecycle-resolved.png`）
- ファイル差分は一貫して該当 `id` の行のみが書き換わる（他の注釈の行・構造行は無変更）ことを
  `git diff --stat` で確認（addressed 化 + resolved 化を合わせた累積差分でも
  `1 insertion(+), 1 deletion(-)` = 1行の中身だけが2回上書きされた形）

## (d) ストリップクリック → シーク要求発火（プレビュー開で実シーク）

- プレビュー未オープン時にストリップを実クリック: フッターに
  「`...を選択しました。プレビューを開くとここからジャンプできます。`」（`no-preview` 分岐）
- `AkariPreviewOpenHandler.open()`（フィンガープリント解決）で実際に `sample.mp4` のプレビューを
  開いた状態で再度ストリップを実クリック: フッターに
  「`...にプレビューをシークしました。`」（`seeked` 分岐、`01-real-seek-with-preview.png`）
- 内部的には `akari.transcript.seekRequested`（akari-transcript の既存コマンド）を文字列IDで
  呼び出しており、コマンド自体は akari-transcript 側で既存のまま無編集

## (e) 非退行

- `akari-transcript`・`akari-preview` のソースは本タスクで一切編集していない（`git diff` で確認
  済み・所有ファイルは `akari-annotations/**` と `apps/shell/package.json` のみ）
- 文字起こしパネル（`akari.transcript.open` 相当の `openFirstTranscript()`）を実行し、3件の字幕
  テキストが正しく表示されることを実測
- プレビュー（`sample.mp4`）と注釈パネルを同時に開いた状態で相互に正常動作することを確認
  （`03-two-annotations-added.png` のタブバーに 俯瞰/注釈/文字起こし/sample.mp4 が同時に開いている）

## L0 / パッケージゲート

- `PYTHON=/usr/bin/python3 npm run build:ext` → exit 0（8拡張、修正前後とも2回実測）
- `npm run lint` → exit 0（警告・エラーなし、修正前後とも2回実測）
- `npm run build`（production）→ browser/node/electron 全て 0 errors
- `npm run package` → `postpackage`（`verify-asar-contents.mjs`）が8拡張全数
  （`akari-shell-strip`〜`akari-annotations`）+ skills + schemas + templates 同梱を確認、
  サイズ 457MB（≤500MB）で GREEN

## 発見した不具合と修正（実装ラウンド2）

1. ストリップの cut/caption セグメントに背景色が無く視認不可（位置計算は正しい） →
   `.akari-annotations-strip-cut`/`.akari-annotations-strip-caption` の背景色 CSS を追加
2. `submitAnnotation()` の楽観的追記とファイル監視による `reloadReview()` がレースし、
   同一注釈が一覧に2重表示される（ディスク上のデータは常に正しく1件・1行diffだった） →
   既存 id の重複チェックを追加

いずれも codex への追加委譲1往復（累計2往復）で修正し、修正後に本サマリの全項目を再実測した。
