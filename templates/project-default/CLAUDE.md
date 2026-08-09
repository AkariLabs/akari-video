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

素材が足りないときは、`akari assets list` でアカウントの素材ライブラリ（無料全部 + 購入済み）を
確認できます。使いたい素材が見つかったら `akari assets fetch <id> --project .` でこのプロジェクトへ
取り込みます（sha256 検証込み）。有料素材は `akari store connect` で接続済みのアカウントで
購入していれば使え、未購入のものは価格付きの `locked` と表示されます。ライブラリの実体は
`~/.akari/assets/` に置かれますが、直接編集せず上記コマンド経由で操作してください。

編集スキルは `.claude/skills/` に入っています。`/analyze-footage`、`/edit-plan`、
`/overlay-authoring`、`/setup-library`、`/harvest-asset`、`/bake-3d` の素の名前で使えます。
Codex や Cursor など他の AI エージェント用の入り口が `.agents/skills/`、`.cursor/skills/`、`.codex/skills/` にあります
（中身は `.claude/skills/` へのリンクです）。
詳しい進め方と、スキル文書を直接読む場合の場所は `AGENTS.md` を参照してください。

画面や会話で利用者へ説明するときは日本語を使い、内部の仕組みの名前ではなく、
「変更履歴」「企画メモ」「素材」など役割が伝わる言葉で案内します。

プロジェクトルート直下に新規ファイルを作らない（`edit.json` 等の既存契約ファイルを除く）。
生成物は `.akari/work/`、証跡は `.akari/reports/`、キャッシュは `.akari/cache/` に置く。
詳しい層の定義は `docs/contract-2026-07-25-project-structure-v0.md`（本モノレポ側）を参照します。

このファイルはあなたのプロジェクトのものです。運用に合わせて自由に書き換えて構いません。
