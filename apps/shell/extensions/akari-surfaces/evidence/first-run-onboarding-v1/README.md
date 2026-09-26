# 初回ガイド v1 実機証跡

Electron を隔離した HOME、AKARI_HOME、ユーザーデータで直接起動し、CDP から操作した。元の作業環境の設定と素材には書き込んでいない。スクリーンショットは全 28 枚で、いずれも 500 KB 未満。

| 段 | 画像 | 確認 |
|---|---|---|
| 1–3 | `01-welcome.png`–`03-invite.png` | 画像付きの歓迎、初回分岐、サンプル案内 |
| 4–8 | `04-tour.png`–`08-prompt.png` | 3 領域のスポットライト、疑似 Explorer からのドロップ、素材プレビュー、AI 回答、依頼文 |
| 9 | `09-replay-transition.png` | タイムラインに字幕が揃った直後の遷移画面。**制作途中の吹き出しと字幕が同時に写る画像は未取得** |
| 10–12 | `10-play.png`–`12-daihon-open.png` | 再生中のタイトルと字幕、字幕選択とサイズ操作、台本 |
| 13 | `13-export-menu.png`–`13-export-result.png` | UI の標準書き出し操作と進捗、MP4 の結果表示。UI からの実行は OSR Electron 異常終了で失敗。短いドライブ別名で `render-cut` を別途実行し、同じプロジェクトの MP4 を作成した後に結果画面へ進んだ |
| 14 | `14-done.png`, `14-connect.png` | 完了画面の Codex CLI 接続ボタンと、押した後の該当行の強調 |
| 後続 | `15-second-launch-no-auto.png`–`18-returning-home.png` | 2 回目は自動表示なし、コマンドから再表示、旧セットアップ、既存利用者の分岐 |

`capture.mjs`、`early.mjs`、`postcheck.mjs` が操作の記録用スクリプト。`observations.json` には中断再開をまたいだ撮影履歴があり、同名画像の再撮影も記録されている。`early-observations.json` と `postcheck-observations.json` は追加撮影の結果。

一時 HOME、取得した動画、書き出した MP4、作業ログは証跡から除去した。画像の元 PNG はリポジトリに含めていない。
