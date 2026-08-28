# AKARI Video プロジェクトの進め方

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

- `assets/` は元動画と音声を置く素材の場所。英語の名前は変えず、原本を書き換えたり削除したりしない。
- `planning/` は企画、分析レポート、編集計画など、人が読む成果物を置く場所。
- `exports/` は完成した動画を書き出す場所。
- `.akari/sidecars/` は素材の分析結果、`.akari/events/` は作業の節目の記録を置く場所。
- 素材の分析結果は `.akari/sidecars/<assets 以下の相対パス>.meta.json` に保存する。
- レポート作成、承認、編集完了、書き出し完了の節目では、`.akari/events/` に記録を
  1 件ずつ新しく追加する。すでにある記録は書き換えたり削除したりしない。
- `.akari/intake.json` の `status` が `submitted` なら `tasks` / `target` / `autonomy` に
  従って進める。`autonomy: checkpoint`（既定）なら企画承認・書き出し前などの要所で
  利用者に確認する。`status: draft` なら進め方が未確定のため、フォームまたは対話で
  確定させてから進める。
- 進め方を `.akari/intake.json` に書くときは、`tasks` は決められた 5 つの id だけを使い、`target` は `duration_s` か `keep_length: true` のどちらか片方にする。
  `status` を `submitted` にする前に lint で確認する。
- プロジェクトルート直下に新規ファイルを作らない（`edit.json` 等の既存契約ファイルを除く）。
  生成物は `.akari/work/`、証跡は `.akari/reports/`、キャッシュは `.akari/cache/` に置く。
  詳しい層の定義は[公開リポの正典](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md)を参照する。
  ローカル候補は (b) `install.sh` 経路の `~/.akari/app/docs/contract-2026-07-25-project-structure-v0.md`、
  (c) モノレポの `<repo>/docs/contract-2026-07-25-project-structure-v0.md` である。

## AKARI Video の在処

- `~/.akari/cli` … CLI 本体とシム（`~/.akari/cli/bin/akari`）。パートナー接続時に配備される。
- `~/.akari/app` … `install.sh` 経路で入れた本体。デスクトップアプリだけを使っている場合は存在しなくてよい。
- アプリ同梱の `<App>/Contents/Resources/packages/` … render-cut・edit-lint などの CLI 実体。Windows は `<install dir>\resources\packages\`。
- アプリ同梱の `<App>/Contents/Resources/media-bin/` … ffmpeg・ffprobe。whisper-cli はビルドにより同梱されないことがある。Windows は `<install dir>\resources\media-bin\`。
- `~/.akari/assets` … 素材ライブラリの実体。

どれも PATH には無い前提とする。パートナー PTY 以外の端末では
`~/.akari/cli/bin/akari` をフルパスで実行する。

## 素材が足りないとき

- アカウントの素材ライブラリ（無料全部 + 購入済み）は `akari assets list` で見える。
- `akari assets fetch <id> --project .` でこのプロジェクトへ取り込む（sha256 検証込み）。
- 有料素材は `akari store connect` 接続済みのアカウントで購入していれば使える。未購入は
  `locked` と価格が表示される。
- ライブラリの実体は `~/.akari/assets/` に置かれる。直接編集せず、上記コマンド経由で操作する。

## プロジェクト内のスキル

`.claude/skills/` 配下の全ディレクトリがそのまま使える。主なもの:

- `/analyze-footage` … 素材ごとの分析
- `/analyze-project` … 複数素材とプロジェクト文脈の統合分析
- `/edit-plan` … 編集計画、レポート、承認、生成
- `/overlay-authoring` … テロップ、図、3D などの画面要素の制作
- `/edit-lint` … 編集結果の決定的な検査と QA
- `/render-cut` … 承認済み編集の書き出しと検証
- `/setup-library` … 素材ライブラリの準備
- `/address-review` … open なレビュー指摘への対応

Codex / Cursor 等のハーネスでは `.agents/skills/` / `.cursor/skills/` / `.codex/skills/`（`.claude/skills/` への symlink）から
同じスキルが自動発見される。

スキルを自動で読まない作業環境では、プロジェクト内相対パス
`.claude/skills/<スキル名>/SKILL.md` から手順を直接読む。
`.claude/skills/` のディレクトリ一覧が、使えるスキルの一覧そのものである。

分析結果と節目の記録の詳しい約束は
`.claude/skills/analyze-footage/references/akari-data-contract.md` を参照する。

利用者へ説明するときは日本語を使い、内部の仕組みの名前ではなく、
「変更履歴」「企画メモ」「素材」など役割が伝わる言葉を使う。

この案内はこのプロジェクトのものです。運用に合わせて自由に書き換えて構いません。
