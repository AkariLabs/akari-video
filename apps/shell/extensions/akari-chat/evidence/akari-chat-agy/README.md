# akari-chat-agy — agy アダプタ（stream-json）の L1 手順（2026-10-11）

対象: AKARI チャットの相手に「Antigravity」を選んだときの `agy` アダプタ。
スクリーンショット・ログはこのリポに置かない（governance の evidence-growth）。基本手順は
`../akari-chat-core/README.md` に従い、補助スクリプト `../akari-chat-core/cdp-l1.cjs` と
`../akari-chat-core/send-turn.sh` を流用する。

## 準備の差分

- ホームは付け替えない（agy は利用者自身のログインを使う）。プロジェクトと設定フォルダだけ一時フォルダにする
- CDP はポート **9433** を使う。Electron の起動後に `lsof -iTCP:9433 -sTCP:LISTEN` で、自分が起動した Electron がポートを掴んでいることを確認する

## 確認項目と実測（2026-10-11・macOS・agy 1.3.3・gemini-3.8-flash-low / gemini-3.7-flash-low）

| 項目 | 手順 | 結果 |
|---|---|---|
| 一覧 | モデルのポップアップの相手の列 | `[data-agent-id=antigravity]`「Antigravity」が出る |
| モデル一覧 | 相手に Antigravity を選ぶ | `agy models` の 18 件（Gemini 3.x / Claude 系 / GPT-OSS）が `[data-chat-model]` に並ぶ |
| モデル切り替え | `gemini-3.8-flash-low` から `gemini-3.7-flash-low` に替え、次のターンを送る | 次のプロセスは `--model` を替え、同じ `--conversation` で続く |
| 会話と道具の行 | `send-turn.sh` で「ls して edit.json を読んで」 | 「実行しました ls」（command）と「読みました edit.json」（read）の行が出て、返事の吹き出しが出る |
| リング | 道具を使ったターンの後に `[data-chat-context]` を見る | `step_update` の各 step の usage に基づく値が表示される |
| 権限 | 画面の「自動」「要所で確認」で道具を使わせる | どちらもアダプタには `auto` で届く。既存の権限モード表どおり、agy は `--dangerously-skip-permissions` で起動する |
| 新しいチャット | 前の会話で語を覚えさせ、`[data-chat-new]` からその語を聞く | 覚えていない。`--conversation` なしで起動する |
| 履歴から再開 | `[data-chat-history-button]` → 前の行 → 覚えさせた語を聞く | 語を答える。`--conversation <前の id>` で起動する |
| アプリ再起動 | 前回のチャットを開いた状態で終了し、再起動する | 前回のチャットが自動で開き、続きから話せる |
| 未ログイン | agy のログインがない状態で送る | `result` は `status: ERROR`、`error: "authentication failed or timed out"`。stderr に agy の案内が出て、アダプタは `error` の kind `auth` を出す。ログインはターミナルで `agy` を起動する。記録は `../../test/fixtures/agy/auth-error.jsonl` |

`--mode accept-edits` で起動すると、headless の agy は確認を出せず、コマンドを黙って拒否した。
このとき `result` は `status: SUCCESS`、返事は空で、`denied_actions` に拒否内容が入る。
アダプタは該当する道具の行を同じ id で「止められました …」に更新し、エラーを 1 行出す。
伏せ字済みの記録は `../../test/fixtures/agy/denied-command.jsonl`。

## 既知の制約・申し送り

1. 画面側の `chatErrorPresentation` はエラー文に `/Antigravity/i` があると Gemini CLI の移行案内へ差し替える。そのためアダプタのエラー文と installHint は `agy` と書いている。画面側の判定を Gemini に限定すれば戻せる
2. `ChatAgentInfo.transport` に agy 用の値がないため、同じ stream-json 系の `claude-stream-json` を名乗っている
3. 「要所で確認」に相当する確認ありモードは agy の headless では成り立たない。`accept-edits` は確認ではなく拒否になる
4. 画像は送らない（`images: false`）。添付はパスをテキストで渡す
5. 履歴から開いても前の吹き出しは再表示されない。会話の正本は agy 側にあり、続きから話せる
