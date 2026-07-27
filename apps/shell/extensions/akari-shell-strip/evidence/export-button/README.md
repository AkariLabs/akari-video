---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-25
---

# export-button L1 検証手法・証跡

タスク: `2026-07-25-export-button`（ワンクリック書き出し = 設定ダイアログ →
パートナーへの書き出し依頼パケット注入 → `.akari/render.json` 読み取り専用の
進捗面）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は
`card-ask-agent`（f740707）/ `left-panel-domain-browser`（35bbc88）と同じ
共有ヘルパー（様式踏襲・中身無改変）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペース（リポ外）へコピーし、
   `.akari/intake.json`（`status: "submitted"`）でホーム v2 の home-flow ゲートを解放。
   `exports/final.mp4` は ffmpeg で生成した実 2 秒動画（成果物リンクの実クリック検証用）
3. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
4. **L1-1（パートナー端末バッファへの到達）だけ**は、実 claude/codex CLI のネットワーク
   越しブートストラップを避けるため、`AkariMenuWidget`（本タスクが所有する
   akari-shell-strip 側のファイル。akari-partner 側は一切編集していない）の
   `postConstruct` に一時デバッグフック `globalThis.__akariShellStripMenuWidgetDebug = this`
   を追加し、そこから「このウィジェット自身が注入済みの `WidgetManager`」経由で
   `widgetManager.getOrCreateWidget('akari-partner-onboarding')`
   （本ファイルの `HOME_WIDGET_ID` 参照と同じ、既存の「文字列 id だけ知っている」
   パターン）で実行中の `AkariPartnerWidget` シングルトンを取得し、
   `terminalService.newTerminal()` + `attachTerminal()`（`begin()` の成功パスが
   呼ぶのと同じ本番コードそのもの）でダミーの echo CLI
   （`while IFS= read -r line; do printf 'ECHO: %s\n' "$line"; done`）を接続した。
   この代替は task.md 許容範囲（実 PTY の起動は不要・パートナー席の端末に
   注入が到達した時点で合格）および `card-ask-agent`（f740707）・`partner-pane`
   検証と同じ前例に基づく
5. フックは証跡取得後（`run-l1.mjs` 実行後）に完全に削除してから最終コミットし
   （`git diff` で不在を確認済み）、フック不在の最終ビルドに対して
   `final-smoke.mjs` で L1-2/L1-3/L1-4/L1-5（フック不要な項目）をもう一度実測した
   （`card-ask-agent` と同じ手順。L1-1 のみフックが無いと検証できないため
   `run-l1.mjs` 側でのみ実測）
6. 送信・受信は実 UI 操作のみで検証: 「書き出し」ボタンの実クリック + 3 段階
   quick-pick への実クリック/実キーボード入力（`Input.insertText` +
   Enter/Escape の実キーイベント）。文脈パケット全文の到達確認は、xterm.js の
   `Terminal.buffer.active` を走査してターミナルバッファの生テキストを再構成する
   方式（折り返し行は `line.isWrapped` で連結）
7. `.akari/render.json` は本拡張が書き込まないため、fixture を Node の
   `fs.writeFile` で段階的に書き換えて進捗面の追随を検証した（開始→50%→完了→
   失敗→壊れたJSON→未知形→削除）
8. 後片付け: 起動した Electron は実 PID を指定して `kill`。各回 `ps aux` で
   `export-button` を含むプロセス（plugin-host / ipc-bootstrap 含む）が
   残っていないことを確認した（隔離 workspace・user-data-dir は検証専用で
   コミット対象外）

## 実測結果（詳細は `run-log.json` / スクリーンショット）

| # | 項目 | 結果 |
|---|---|---|
| L1-1a | 既定値（1080p 横・final.mp4・lint する）で確定 → 端末バッファに文脈パケット全文 | `08-injection-defaults.png`。実測パケット: `【書き出し依頼】edit.json を render-cut スキルで書き出してください。設定: 解像度 1080p 横・出力名 final.mp4・lint 再実行 する。ユーザーは書き出しダイアログで設定を確定済み（明示承認済み・チャット再確認不要）。進捗を .akari/render.json に随時書き込みながら進めてください` が PTY ローカルエコー + ダミー CLI の `ECHO:` 応答の両方に全文一致で出現 |
| L1-1b | カスタム値（正方形・my-square-export.mp4・lint しない）で確定 → 同様 | `09-injection-custom.png`。設定 3 値がそれぞれ正しく反映されたパケットが全文一致で出現 |
| L1-2 | edit.json 無しワークスペース → ボタン disabled + ツールチップ | `01-editjson-absent-disabled.png`。実測ツールチップ: `edit.json がまだありません。編集を進めてから書き出してください。`。edit.json をランタイムに作成すると FileService watch で reactive に有効化（`02-editjson-present-enabled.png`） |
| L1-3 | パートナー未接続状態で設定 3 項目を確定 | `06-not-connected-toast.png`（初回）+ `final-smoke-03-not-connected-toast.png`（デバッグフック除去後の最終ビルド再実測）。実測トースト文言: `パートナー未接続。ホームの「パートナーに接続する」から接続してください`（④と同一文言）。端末注入は発生しない（未接続時点でチャンネル未確立） |
| キャンセル | 設定ダイアログ途中で Escape | トースト件数不変・quick-input は表示解除。注入コマンドは呼ばれない（no-op） |
| L1-4 | `.akari/render.json` 段階的書き換え（開始→50%→完了→失敗→壊れたJSON→未知形→削除） | `10`〜`16`.png（+ `final-smoke-04`〜`06`.png）。開始 `書き出し中（planning）（15%）`・50% `書き出し中（rendering）（50%）`・完了 `書き出し完了（100%）成果物を開く（exports/final.mp4）`・失敗 `書き出しに失敗しました: <verify.findings のエラー文言>`・壊れたJSON/未知形はいずれも `進捗不明（書き出し中）`。render.json 削除で進捗面ごと非表示に戻る。render.json 処理コード自身が起因する console error は 0（`renderSweepErrorDelta: 0` — スイープ開始直前を基準にした差分で検証。詳細は「既知のノイズ」参照） |
| 成果物リンク | 完了時の「成果物を開く」クリック | `13-artifact-opened.png`。実際に `final.mp4` タブが開きプレビュー再生できることを確認（`.lm-TabBar-tabLabel` に `final.mp4` が出現） |
| L1-5 回帰 | メニュー既存項目（タイムライン/文字起こし/ホーム/変更を見る）・スキル一覧・素材タブ | `17-regression-materials-tab.png`（+ `final-smoke-01`/`07`.png）。全項目無退行 |
| 隔離・後片付け | 実 Electron 隔離起動 + 終了時 kill | 各回 `ps aux` で `export-button` を含むプロセス残存ゼロを確認 |

## 既知のノイズ（export-button のコードとは無関係）

`window.error: Uncaught Error: This API only accepts integers` が
`finalConsoleErrorCount` に 1 件計上されるが、これは **xterm.js**
（`node_modules/xterm/lib/xterm.js`）内部の resize 処理に由来するもので、
本タスクが追加した `render-progress.ts` / `export-request-packet.ts` /
`akari-menu-widget.tsx` のいずれにも一致しない（メッセージ文字列で
node_modules 全体を grep して特定）。L1-1 証跡取得専用のダミー端末
アタッチ（この経路にのみ登場する xterm インスタンスの初期 resize）でのみ
観測され、render.json フォールバックスイープ開始直前を基準にした
`renderSweepErrorDelta` は 0（= render.json 処理そのものは無エラー）。
最終成果物（本番ビルド）は当該デバッグ用ダミー端末アタッチ経路を持たない
ため、実運用でこのノイズが再現することはない。

## コマンド ID・文脈パケット確定値

- 呼び出しコマンド: `akari.partner.injectPrompt`（④ `f740707` で新設済み。
  本タスクは ID 文字列呼び出しのみ・akari-partner 側は無改造）
- パケットは task.md 指定の固定テンプレートに一字一句一致（`export-request-packet.ts`
  の単体テスト 2/2 でも検証）

## 未確認事項

- 実 claude/codex CLI（実ネットワーク越しのインストール・実ログイン）を使った
  検証は本環境では実施していない（ダミー CLI での代替は task.md 明記の許容範囲）
- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみで検証）
- render.json の途中フェーズ文字列（`phase` の実際の遷移値。本検証では
  `planning`/`rendering`/`verified`/`failed` を自作 fixture として使用）は
  render-cut 側の実運用でどのような値が実際に書き込まれるか未確認（寛容
  リーダーとして phase 値をそのままラベルに表示するため、実際の値が違っても
  例外にはならない設計だが、パーセンテージの目安表示は推測ベース）
