---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-25
---

# card-ask-agent L1 検証手法・証跡

タスク: `2026-07-25-card-ask-agent`（素材カード「エージェントに頼む」= 文脈パケットの
PTY 注入）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は
`left-panel-domain-browser`（35bbc88）の同名ファイルをそのままコピーした
共有ヘルパー（様式踏襲・中身無改変）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペースへコピーし、素材フィクスチャを追加:
   `assets/analyzed-clip.mp4`（ffmpeg 生成の実 6 秒動画）+
   `.akari/sidecars/assets/analyzed-clip.mp4.analysis/analysis.json`（分析済み）、
   `assets/unanalyzed-clip.mp4`（sidecar なし = 未分析）。
   `.akari/intake.json`（`status: "submitted"`）でホーム v2 の home-flow ゲートを
   実ユーザーの「進め方フォーム送信後」状態相当にして素材タブへ到達可能にした
   （home-flow のコード自体は無改変・タスクの禁止事項どおり）。
   `edit.json` は lint バッジ回帰確認用の最小フィクスチャ
3. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
4. L1-1・L1-2（パートナー端末セッション在り）は、実 claude/codex CLI のネットワーク越し
   ブートストラップ（`begin()`）を避け、`AkariPartnerWidget.attachTerminal()`
   （`begin()` の成功パスが呼ぶのと同じ本番コードそのもの）を直接呼び、ダミーの
   echo シェルスクリプト（`while IFS= read -r line; do printf 'ECHO: %s\n' "$line"; done`）
   をバックエンド CLI として接続した。この代替は task.md 許容範囲（実 PTY の起動は
   不要・パートナー席の端末に注入が到達した時点で合格）および `partner-pane` 検証
   （`apps/shell/evidence/partner-pane/README.md`）と同じ前例に基づく
5. `attachTerminal()` を直接呼ぶために、検証時のみ widget インスタンスへ到達する
   一時デバッグフック（`globalThis.__akariPartnerWidgetDebug = this`）を
   `AkariPartnerWidget.init()` に追加して検証し、**証跡取得後に完全に削除してから
   最終コミットした**（partner-pane 検証と同じ流儀）。最終差分に当該フックは
   含まれない（`git diff` で確認済み）。フック除去後に `npm run build` を再実行して
   ビルドが崩れないことを確認し、さらに未接続トースト（L1-3）・キャンセル無反応
   （L1-4）の 2 点は**フック除去後の最終ビルドに対してもう一度実機再実測した**
   （`final-smoke-*.png`・フック不在を `!window.__akariPartnerWidgetDebug` で確認済み）
6. 送信・受信は実 UI 操作のみで検証: 素材カードの「エージェントに頼む」ボタンの
   実クリック + Theia quick-input への `Input.insertText` による実キーボード入力 +
   Enter/Escape の実キーイベント。文脈パケット全文の到達確認は、xterm.js の
   `Terminal.buffer.active` を走査してターミナルバッファの生テキストを再構成する
   方式（折り返し行は `line.isWrapped` で連結）— 表示上の折り返しに影響されない
7. 後片付け: 起動した Electron は実 PID を指定して `kill`。各回 `ps aux` で
   `card-ask-agent/apps/shell` を含むプロセスが残っていないことを確認した
   （隔離 workspace・user-data-dir は検証専用でコミット対象外）

## 実測結果（詳細は `run-log.json` / スクリーンショット）

| # | 項目 | 結果 |
|---|---|---|
| L1-1 | 分析済み素材カード → quick-input 実入力 → 端末バッファに文脈パケット全文 | `07-analyzed-injection.png`。実測パケット: `【素材】assets/analyzed-clip.mp4（尺 0:06・分析済み・analysis: .akari/sidecars/assets/analyzed-clip.mp4.analysis/analysis.json）について: この素材を要約して`。ターミナルバッファ（PTY ローカルエコー分）+ ダミー CLI の `ECHO:` 応答の両方に全文一致で出現 |
| L1-2 | 未分析素材カード → 同様 | `08-unanalyzed-injection.png`。実測パケット: `【素材】assets/unanalyzed-clip.mp4（尺不明・未分析）について: これを分析して`。`尺不明`・`未分析`で成立し、`analysis:` 要素は不出現（相対パス・依頼文はそのまま反映） |
| L1-3 | パートナー未接続状態で同アクション | `04-not-connected-toast.png`（初回）+ `final-smoke-01-toast.png`（フック除去後の最終ビルド再実測）。実測トースト文言: `パートナー未接続。ホームの「パートナーに接続する」から接続してください`（案内文中の「パートナーに接続する」はホームの実ボタンラベルと一致）。端末注入は発生しない（テスト時点でパートナー端末が存在しない） |
| L1-4 | 入力キャンセル | `05-cancel-no-op.png`（初回）+ `final-smoke-02-cancel.png`（フック除去後の最終ビルド再実測）。トースト件数はキャンセル前後で不変（新規トーストなし）・quick-input は `display: none` に復帰。注入コマンドは呼ばれない |
| L1-5 回帰 | カード表示（サムネ/尺/状態ドット）・ドロップ取り込み（対応/非対応）・lint バッジ・タブ切替 | `01-materials-initial.png`・`02-drop-regression.png`・`03-lint-badge.png`。analyzed-clip.mp4: サムネ有・`0:06`・`分析済み`ドット。unanalyzed-clip.mp4: プレースホルダ・`--:--`・`未分析`ドット。両カードに新規の「エージェントに頼む」ボタンが追加されているが既存要素は無変化。ドロップ: 対応拡張子は取り込みカード化・非対応は実文言トーストで拒否。Lint バッジ: `9 件`（fixture の `intake.json` 最小スタブに起因する検出数であり、edit-lint 自体は正常応答 = クラッシュなし）。タブ切替（素材⇔プラン⇔カタログ）は無退行 |

## コマンド ID・文脈パケット確定値

- 追加コマンド: `akari.partner.injectPrompt`（`akari-partner-command-contribution.ts`
  の `AkariPartnerCommands.INJECT_PROMPT`）。既存 `akari.partner.send` は無改造
- 文脈パケットの形（要素の有無が契約、文言は調整可）:
  `【素材】<相対パス>（尺 <M:SS>・<分析済み|未分析>[・analysis: <相対パス>]）について: <入力文>`

## 未確認事項

- 実 claude/codex CLI（実ネットワーク越しのインストール・実ログイン）を使った検証は
  本環境では実施していない（ダミー CLI での代替は task.md 明記の許容範囲）
- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみで検証）
- ANSI エスケープ除去・複雑な TUI 出力での見え方は partner-channel.ts の v0 実装
  範囲内（本タスクでは無改造・未追加検証）
