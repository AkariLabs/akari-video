# AKARI Video プロジェクト

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

このプロジェクトでは、次の役割に沿って編集を進めます。

- `assets/` … 元動画と音声を置く素材の場所。原本は読み取り専用として扱い、書き換えや削除をしません。
- `planning/` … 企画、分析レポート、編集計画など、人が読む成果物を置く場所。
- `exports/` … 完成した動画を書き出す場所。
- `.akari/` … 素材の分析結果と、作業の節目の記録を置く場所。

素材の分析結果は `.akari/sidecars/<assets 以下の相対パス>.meta.json` に保存します。
レポート作成、承認、編集完了、書き出し完了の節目では、`.akari/events/` に記録を
1 件ずつ新しく追加します。すでにある記録は書き換えたり削除したりしません。

今回の進め方は `.akari/intake.json` に記録されています。`status` が `submitted` のときは、
そこに書かれた `tasks`（やること）・`target`（仕上がりの尺）・`autonomy`（おまかせの度合い）に
従って進めます。`autonomy` が `checkpoint`（既定）のときは、企画の承認や書き出しの前などの
要所で必ず利用者に確認します。`status` が `draft` のときは進め方がまだ決まっていないので、
フォームまたは対話で確定させてから作業を始めます。

進め方を `.akari/intake.json` に書くときは、`tasks` は決められた 5 つの id だけを使い、`target` は `duration_s` か `keep_length: true` のどちらか片方にします。`status` を `submitted` にする前に lint で確認します。

素材が足りないときは、`akari assets list` でアカウントの素材ライブラリ（無料全部 + 購入済み）を
確認できます。使いたい素材が見つかったら `akari assets fetch <id> --project .` でこのプロジェクトへ
取り込みます（sha256 検証込み）。有料素材は `akari store connect` で接続済みのアカウントで
購入していれば使え、未購入のものは価格付きの `locked` と表示されます。ライブラリの実体は
`~/.akari/assets/` に置かれますが、直接編集せず上記コマンド経由で操作してください。

## AKARI Video の在処

- `~/.akari/cli` … コマンド操作の本体と入口（`~/.akari/cli/bin/akari`）です。パートナー接続時に配備されます。
- `~/.akari/app` … `install.sh` から入れた AKARI Video 本体です。デスクトップアプリだけを使っている場合は、存在しなくて構いません。
- アプリ同梱の `<App>/Contents/Resources/packages/` … render-cut・edit-lint など、編集や検査を実行するコマンドの実体です。Windows では `<install dir>\resources\packages\` にあります。
- アプリ同梱の `<App>/Contents/Resources/media-bin/` … ffmpeg・ffprobe があります。whisper-cli はビルドによって同梱されないことがあります。Windows では `<install dir>\resources\media-bin\` にあります。
- `~/.akari/assets` … 素材ライブラリの実体です。

どれも PATH には無い前提です。パートナー PTY 以外の端末では、
`~/.akari/cli/bin/akari` をフルパスで実行してください。

## 編集スキル

`.claude/skills/` 配下の全ディレクトリがそのまま使えます。主なもの:

- `/analyze-footage` … 素材ごとの内容を分析します。
- `/analyze-project` … 複数の素材とプロジェクト全体の文脈をまとめて分析します。
- `/edit-plan` … 編集計画を作り、レポートと承認を経て編集内容へ反映します。
- `/overlay-authoring` … テロップ、図、3D などの画面要素を制作します。
- `/edit-lint` … 編集結果を機械的に検査し、仕上がりの確認を支えます。
- `/render-cut` … 承認済みの編集を書き出し、完成ファイルを検証します。
- `/setup-library` … 利用できる素材を準備します。
- `/address-review` … 未対応のレビュー指摘を編集へ反映します。

Codex や Cursor など他の AI エージェント用の入り口が `.agents/skills/`、`.cursor/skills/`、`.codex/skills/` にあります
（中身は `.claude/skills/` へのリンクです）。
詳しい進め方と、スキル文書を直接読む場合の場所は `AGENTS.md` を参照してください。

画面や会話で利用者へ説明するときは日本語を使い、内部の仕組みの名前ではなく、
「変更履歴」「企画メモ」「素材」など役割が伝わる言葉で案内します。

プロジェクトルート直下に新規ファイルを作らない（`edit.json` 等の既存契約ファイルを除く）。
生成物は `.akari/work/`、証跡は `.akari/reports/`、キャッシュは `.akari/cache/` に置く。
詳しい層の定義は[公開リポの正典](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md)を参照します。
ローカルでは (b) `install.sh` から入れた場合の `~/.akari/app/docs/contract-2026-07-25-project-structure-v0.md`、
(c) モノレポを持っている場合の `<repo>/docs/contract-2026-07-25-project-structure-v0.md` からも確認できます。

このファイルはあなたのプロジェクトのものです。運用に合わせて自由に書き換えて構いません。
