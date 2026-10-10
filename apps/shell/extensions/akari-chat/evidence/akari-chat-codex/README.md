# akari-chat-codex — Codex アダプタ（codex app-server）の L1 手順（2026-10-11）

対象: AKARI チャットの相手に「Codex」を選んだときの `codex app-server`（JSON-RPC over stdio）アダプタ。
スクリーンショット・ログはこのリポに置かない（governance の evidence-growth）。手順は `../akari-chat-core/README.md` と同じで、
補助スクリプト `../akari-chat-core/cdp-l1.cjs` / `send-turn.sh` をそのまま使う。

## 準備の差分

- ホームは付け替えない（Codex は利用者自身の ChatGPT ログインを使う。資格情報ファイルは読まない）。プロジェクトと設定フォルダだけ一時フォルダ
- **CDP のポートは並走レーンと重ならない番号を選び、起動後に `lsof -iTCP:<port> -sTCP:LISTEN` で自分の Electron が掴んでいることを確かめる**
  （先に別の Electron が掴んでいると、こちらは黙って CDP を開けず、補助スクリプトは相手の窓を操作してしまう）

## 確認項目と実測（2026-10-11・macOS・codex-cli 0.162.1・gpt-6-luna / gpt-5.6-luna・effort low）

| 項目 | 手順 | 結果 |
|---|---|---|
| 一覧 | モデルのポップアップの相手の列 | `[data-agent-id=codex]`「Codex」が出る |
| 会話 | `send-turn.sh` で 3 往復以上 | 吹き出しで返る |
| モデル | `[data-chat-model="gpt-5.6-luna"]` → 1 ターン | Codex 側の記録（turn_context）でそのターンから model が切り替わる。承認は on-request + auto_review、サンドボックスは workspace-write |
| 未知のモデル | 画面の既定 `sonnet` のまま新しいチャット / 履歴の model が `sonnet` の会話を開く | 渡さずに Codex の既定で動く。履歴の model は実際のモデルへ更新される |
| 道具の行 | ls と新規ファイル（apply_patch） | `実行しました ls`（シェルの包みは外す）/ `書きました planning/notes2.md +3 −0`、押すと出力・差分が開く。ターン終了時に running の行は残らない |
| 止める | 長文の途中で `[data-chat-stop]` | turn/interrupt で止まり、続けて送れる |
| 新しい会話 / 開き直し | `[data-chat-new]` → 履歴 → 前の会話（アプリの再起動後も） | thread/resume で前の内容を覚えている |
| スキル | 「edit-lint スキルで edit.json を検査して」 | Codex がスキル（SKILL.md）を読み edit-lint を実行 → PASS |
| リング | 任意のターン後 | `[data-chat-context]` に thread/tokenUsage/updated の last.totalTokens と modelContextWindow |
| 画像 | 画像ファイルを添付（localImage） | ツールを使わずに画像の色を答える |
