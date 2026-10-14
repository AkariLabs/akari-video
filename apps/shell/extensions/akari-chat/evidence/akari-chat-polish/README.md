# akari-chat-polish — AKARI チャット仕上げ 2 の L1 手順（2026-10-11）

対象: 相手（Claude Code / Codex / ACP の opencode・Gemini CLI）を替えたときのモデル表示・履歴・起動時エラー・止める・再開・起動中表示。
スクリーンショット・ログはこのリポに置かない（governance の evidence-growth）。起動・CDP 接続は `../akari-chat-core/README.md` と同じで、
補助スクリプト `../akari-chat-core/cdp-l1.cjs` / `send-turn.sh` をそのまま使う。

## 準備の差分

- ホームは付け替えない（各 CLI のログインを使う）。プロジェクト・`THEIA_CONFIG_DIR`・`--user-data-dir` は一時フォルダ、プロジェクトは `akari new` で scaffold
- CDP のポートは他の作業と重ならない番号にし、`lsof -iTCP:<port> -sTCP:LISTEN` で自分の Electron が掴んでいることを確かめる
- 終了は CDP から `window.electronTheiaCore.close()`（正規の終了経路。SIGTERM だとレイアウトと前回のパートナーの記録が残らないことがある）

## 確認項目と実測（macOS・Claude haiku / Codex gpt-6-luna low / opencode 既定モデル）

| # | 手順 | 結果 |
|---|---|---|
| 1 | Claude → `[data-chat-new]` → Codex → `[data-chat-new]` → opencode、各 1 往復 | 入力欄の下 `[data-chat-model-label]` が相手ごと（Haiku / GPT-6-Luna · 低い / OpenCode Zen/Big Pickle）。相手を選んだ直後は「起動しています…」、1.5 秒を超えると会話の領域に `[data-chat-starting]`「起動しています…（opencode）止める」 |
| 1b | opencode のモデルのポップアップ | 132 件 → `[data-chat-model-search]` が出る。「pickle」で 1 件に絞れる |
| 2 | `[data-chat-history-button]` → 各行 | 押した直後にバナー `[data-chat-resume-banner]` がその会話の題名・相手もその会話のもの。**起動中に送っても**開いた会話へ届き、合言葉（みかん / りんご / ぶどう）を答える |
| 3 | 新しいチャット → Gemini CLI を選ぶ（送らない） | `role=alert` に「Gemini CLI にログインが必要です」+「個人向けの Google ログインでは使えなくなりました（Antigravity へ移行）」、`[data-chat-next-step]` に「ターミナルで gemini を実行（コピー）」「別の相手を選ぶ」。sessions.json に行は増えない |
| 4 | 長文を書かせて `[data-chat-stop]`（Claude・Codex） | 赤いエラーなし・`[data-chat-stopped]`「止めました」→ 続けて送れる |
| 5 | チャットで 1 往復 → 終了 → 起動 | 何も押さずにチャットが前面・前回の会話（相手・題名）のバナー → 続きを話せる |

## 既知の制約

- 新しいプロジェクトの初回起動でパートナー側が別のパートナー（例: DeepSeek の作業画面）を非同期で自動起動していると、その完了が「前回のパートナー」の記録を上書きする。
  チャットは送信のたびに記録をチャットへ戻すので、チャットで 1 回でも送れば次の起動からはチャットが前面に出る
- 未インストールの相手（暗いアイコン・`[data-chat-install-guide]`）は実機で再現していない（検出は PATH 以外のホーム配下も見るため、利用者の環境を変えずに「入っていない」状態を作れない）
