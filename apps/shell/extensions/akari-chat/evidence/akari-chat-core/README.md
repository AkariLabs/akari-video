# akari-chat-core — AKARI チャットの L1 手順（2026-10-11）

対象: 右パネルの「AKARI チャット」（Claude Code を stream-json で動かす最初のアダプタ）。
記録物（スクリーンショット・ログ）はこのリポには置かない（governance の evidence-growth）。ここには手順と補助スクリプトだけを置く。

## 準備

- `apps/shell` を `npm run build`（electron の実体と native モジュールが要る）
- `akari new <一時ディレクトリ>/proj` で scaffold 済みのプロジェクトを作る（macOS では `/tmp` ではなく実体パスを渡す）
- Electron を直接起動する（設定フォルダは隔離・ホームは付け替えない — Claude Code のログインを使うため）

```sh
env -u ELECTRON_RUN_AS_NODE THEIA_CONFIG_DIR=<隔離>/theia \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell> <proj> \
  --remote-debugging-port=<port> --user-data-dir=<隔離>/ud --no-sandbox \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
```

- `cdp-l1.cjs` は puppeteer-core（リポ直下の node_modules にある puppeteer 経由）で main renderer に繋ぐ。
  `send-turn.sh "<発話>"` は 1 ターン送って終わりまで待つ。スクリーンショットは `shotel '#theia-right-content-panel' <png>`（右パネルだけ。ホームのアカウント表示を写さない）

## 確認項目と実測（2026-10-11・macOS・Claude Code 2.1.296・haiku / sonnet）

| 項目 | 手順 | 結果 |
|---|---|---|
| 入口 | パートナー → 先頭の `[data-akari-chat-card]` | チャットが右パネルに開く |
| 会話 | `send-turn.sh` で 3 往復 | 吹き出しで返る |
| 道具の行 | Read / Bash / Edit を使わせる | `[data-tool-kind]` の 1 行（read / command / write +n −m / think）。押すと入力と出力・差分が開く |
| 表 | 表でまとめさせる | `[data-chat-role=assistant] table` |
| ask | 選択肢で聞かせる → 入力欄が空のままキー `2` | `[data-ask-option]` が 3 つ → 2 番が送られる |
| モデル | `[data-chat-model-button]` → `[data-chat-model=sonnet]` → 1 ターン | 次のターンのプロセスが `--model sonnet --resume <id>`・init の model が sonnet |
| 止める | 長文を書かせて `[data-chat-stop]` | セッションに中断が記録され、続けて送れる |
| 新しいチャット / 履歴 | `[data-chat-new]` → 1 ターン → `[data-chat-history-button]` → 前の行 | 前の会話の内容を覚えている |
| 再起動 | 前回がチャットのまま終了 → 起動 | 何も押さずにチャットが開き `[data-chat-resume-banner]`・内容を覚えている |
| リング | 任意のターン後 | `[data-chat-context]` の `data-used-tokens` が result の値 |
| スキル | 「edit-lint スキルで検査して」 | `[data-tool-kind=skill]`「使いました edit-lint」→ edit-lint が走る |
| ドロップ | `dropfiles '.akari-chat-thread' <proj>/assets/<mp4>` → 調べさせる | 添付チップ `assets/…` → パートナーが ffprobe で読む |
| 回帰 | パートナー → Claude Code CLI / Codex CLI / DeepSeek Harness | どれも従来どおり開く |

## 既知の未達

- プロジェクト外のメディアのドロップ（と添付ボタンで選んだ外のメディア）は、`assets/` への取り込みの呼び出し
  （akari-project の `recordDroppedAssets`）が返らず添付チップにならない。チャットの frontend module が
  `/services/akari-project` へ 2 本目のプロキシを作っているのが原因。既存の拡張と同じく `akari-project` へ依存して
  `AkariProjectService` を注入すれば直る見込み（次のレーンで対応）
