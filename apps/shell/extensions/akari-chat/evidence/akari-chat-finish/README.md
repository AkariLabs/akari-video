# akari-chat-finish — AKARI チャットの仕上げの L1 手順（2026-10-11）

対象: 音声入力（SpeechAnalyzer）・履歴・つなぐの行と添付メニュー・レビュー添付のチップ・進め方のチップ・アクティビティ・
プロジェクト外のドロップ（`AkariProjectService` の注入）。
記録物（スクリーンショット・ログ）はこのリポには置かない（governance の evidence-growth）。ここには手順と補助スクリプトだけを置く。

## 準備

- 起動・CDP 接続は `../akari-chat-core/README.md` と同じ（`cdp-l1.cjs` / `send-turn.sh` をそのまま使う）
- 聞き取りヘルパー: `node apps/shell/resources/scripts/build-vibe-stt-helper.mjs`（`packages/akari-vibe/native/bin/` は git 無視）
- マイクの代わりに音声ファイルを流す: Electron を `AKARI_EAR_TEST_FILE=<16kHz・モノラル・16bit の WAV の絶対パス>` 付きで起動する
  （akari-vibe-dock の ear-service の検証用の口。マイクの許可を求めずにヘルパーへ `--file` で流す）。
  例: `say -v Kyoko -o v.aiff "テロップをもう少し上に動かしてください"` →
  `ffmpeg -i v.aiff -af apad=pad_dur=3 -ar 16000 -ac 1 -c:a pcm_s16le v.wav`。
  **末尾に無音を足すこと**（ファイル入力ではヘルパーが final を出さず、無音が無いと最後の数文字が途中経過に出ないまま終わる）
- `preview-pin.cjs`（このディレクトリ）: プレビューの webview の中のピンを puppeteer の frame 経由で押す

## 確認項目と実測（2026-10-11・macOS 26・Claude Code・haiku）

| 項目 | 手順 | 結果 |
|---|---|---|
| マイク | `[data-chat-mic]` | `data-chat-mic-state=recording`・ボタンが赤・`[data-chat-listening]` に波形と途中の文字 → 止まると入力欄に「…動かしてください。」が残る（送られない） |
| 履歴 | 1 ターン → `[data-chat-new]` → 1 ターン → `[data-chat-history-button]` | 2 件（新しい順・タイトル / 相手 / 更新日時）→ 古い方を押す → 「前回の会話の続きです」→ その会話の内容を覚えている |
| 名前 / 外す | `[data-chat-history-rename]` → `[data-chat-history-rename-input]` に入力して Enter / `[data-chat-history-remove]` | `.akari/chat/sessions.json` の title が変わる / 索引から外れる |
| つなぐの行 | `[data-chat-connect-row]` | つながったもののアイコンが重なって並ぶ → 押すと つなぐ画面 |
| 添付メニュー | `[data-chat-attach]` | ファイル / フォルダ / 画面を録画 / つないだサービスで作る（`[data-chat-create-menu]` → 「fal で…」を prefill）/ ほかをつなぐ… |
| レビュー添付 | `preview-pin.cjs open assets/<mp4>` → `pin raw <メモ>` → `send raw` → `send-turn.sh` | 入力欄の上に `[data-chat-review-chip]`（コマの絵・素材・時刻・メモ・×）→ 送るとユーザーの吹き出しの上にも同じチップ → パートナーが素材・時刻・依頼を言い直せる |
| 外のドロップ | `cdp-l1.cjs dropfiles '.akari-chat-thread' <プロジェクト外の mp4>` | `assets/` に取り込まれてチップ → パートナーが ffprobe で読める |
| 画面を録画 | 添付メニュー → 画面を録画 → `[data-chat-screen-recording]` で停止 | `assets/screen-<時刻>.mp4`（h264・長さあり）→ チップ |
| 進め方 | `[data-chat-permission-chip]` | 自動 / 要所で確認 / 毎回確認（stream-json の相手では理由付きで選べない）。要所で確認はパートナー共通の設定へ書かない |
| アクティビティ | 並列の道具を 3 つ走らせる | 入力欄の右上に `[data-chat-activity]`「作業中 N」→ 押すと一覧（パネルの内側） |

## 既知の制約

- 署名していない開発用の Electron から画面を録画すると、許可の状態は `granted` と返るのに中身が壁紙だけになることがある（macOS の
  画面収録の許可は配布版のアプリに付く）。経路（画面の選択・mp4 の保存・`assets/`・チップ）はこれで確かめられるが、中身の確認は配布版で行う
