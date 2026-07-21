---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-21
---

# partner-pane L1 検証手法・証跡

タスク: `2026-07-21-partner-pane`（パートナーペイン 44% 既定 + チャットガワ v0）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket` のみ、既存の `akari-preview` の
e2e 手法 `docs/e2e-method/scripts/run-inspector-writeback-e2e.mjs` と同じ流儀）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペースへコピー（元ファイルは無改変）
3. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
4. 実 claude/codex CLI のブートストラップ（`claude.ai/install.sh` 取得・open-vsx 拡張
   インストール等、いずれも実ネットワーク越し）は本検証環境では不適切なため、
   `PartnerCatalogEntry` 経由の `begin()` は使わず、`AkariPartnerWidget.attachTerminal()`
   （`begin()` が成功パスで呼ぶのと同じ本番コードそのもの）を直接呼び、ダミーの
   echo シェルスクリプトをバックエンド CLI として接続した。この代替は task.md
   に明記された許容（「実 claude CLI が使えない環境なら echo 系のダミー CLI で
   注入経路を実証」）に基づく
5. `attachTerminal()` を直接呼ぶために、検証時のみ widget インスタンスへ到達する
   一時デバッグフック（`globalThis.__akariPartnerWidgetDebug = this`）を
   `AkariPartnerWidget.init()` に追加して検証し、**証跡取得後に完全に削除して
   から最終コミットした**（`akari-shell-strip` の S15 テストコード除去と同じ流儀。
   最終差分に当該フックは含まれない — `git diff` で確認済み）
6. 送信・受信は**実 UI 操作のみ**で検証: 入力欄への実クリック + `Input.insertText`
   による実キーボード入力、送信ボタンの実クリック。開発者モード切替は
   `PreferenceService.set('akari.developerMode', ...)` を実行し、実際に
   right panel のタブ切り替え（DOM の attach/detach）が起きることを確認した
7. 後片付け: 起動した Electron は実 PID を指定して `kill`。隔離ワークスペース・
   ダミー CLI スクリプトは検証後に削除しコミットしていない

## 実測結果の要旨（詳細は `run-log.json` / `resize-persistence-check.json`）

| 項目 | 結果 |
|---|---|
| 44% 既定幅 | 接続前後とも右パネル比率 `0.4402`（1120px 中 493px）。モックの `.partner` 列（44%）と一致 |
| 既知の落とし穴と対策 | `AkariPartnerContribution.onStart()`（右パネルへ最初の widget を追加する処理）は `attachShell()`（shell を document へ実 attach する処理）より**前**に完了するため、素朴に `initialSizeRatio` を書き換えるだけでは detached 状態の `clientWidth`（実測 336px 相当）を拾ってしまい、実際には 1120px 中 148px（13.2%）にしかならない不具合を実機で発見した。`onDidInitializeLayout`（shell attach 後に発火）で、`StorageService` の `layout` キー未保存（＝真の初回起動）に限り明示的にピクセル値を再計算・補正する実装に修正し、44.02% を確認した |
| 注入実証（送信→CLI→応答） | 実入力欄クリック＋実キーボード入力で `hello from the akari-partner e2e verification script` を送信 → ダミー CLI（`while read line; do printf 'ECHO: %s\n' "$line"; done`）が同文字列を PTY echo + `ECHO: ...` 付きで応答 → ガワの AI 吹き出しに両方がテキスト化されて表示（`03-after-send-reply-received.png`） |
| 既知の落とし穴と対策（その2） | 開発者モード off（既定）で terminal widget を接続直後に `parent = null` で即 detach すると、xterm.js 側の初期化（`term.open()` 経由で `onOutput` の配信元 `term.onWriteParsed` の購読が張られる）が一度も走らず、CLI からの応答が永久に届かない不具合を実機で発見した。修正: 接続時に一度だけ `shell.activateWidget()` で可視化 → xterm の DOM（`.xterm`）が生成されるのを確認してから、開発者モードに応じた最終表示（ガワ/生ターミナル）を確定する `ensureTerminalOpened()` を追加した |
| 開発者モード on | 生ターミナル（PTY 出力そのまま）がアクティブタブになる（`04-developer-mode-on-raw-terminal.png`） |
| 開発者モード off | ガワ（吹き出しログ）に戻り、直前までのチャット履歴が保持されたまま復元される（parent=null 方式の detach-without-dispose により CLI セッション・チャット履歴とも継続。`05-developer-mode-off-gawa-restored.png`） |
| リサイズ尊重（同一セッション） | `shell.resize(640, 'right')` 実行後、既定比率を再適用する処理（`onStart` と同じロジック）をもう一度走らせても幅は 640px のまま変化しない（強制リセットが起きない） |
| リサイズ尊重（アプリ再起動をまたぐ） | 640px へリサイズ → 正規のウィンドウクローズ（`beforeunload` 発火 → `ShellLayoutRestorer.storeLayout()`）→ 同じユーザーデータ・同じワークスペースでアプリを再起動 → ログに `<<< The layout has been successfully restored.` → 右パネル幅は 640px のまま（44% の 493px には戻らない）ことを実機で確認した |
| L0（`build:ext` / `lint`） | いずれも exit 0（本タスクの変更のみでの実測、デバッグフック除去後の最終状態で再実行して確認済み） |

## 未確認事項

- 実 claude/codex CLI（実ネットワーク越しのインストール・実ログイン）を使った
  検証は本環境では実施していない（ダミー CLI での代替は task.md 明記の許容）
- ANSI エスケープ除去は簡易実装（task.md 許容範囲）。色付き・カーソル制御を
  多用する複雑な TUI 出力での見え方までは検証していない
- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみで検証）
