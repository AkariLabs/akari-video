# AKARI Video プロジェクトの進め方

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
- プロジェクトルート直下に新規ファイルを作らない（`edit.json` 等の既存契約ファイルを除く）。
  生成物は `.akari/work/`、証跡は `.akari/reports/`、キャッシュは `.akari/cache/` に置く。
  詳しい層の定義は `docs/contract-2026-07-25-project-structure-v0.md`（本モノレポ側）を参照する。

## プロジェクト内のスキル

次の 6 本がプロジェクト内に実体で入っている。対応する作業では素の名前で使う。

- `/analyze-footage` … 素材 1 本の分析
- `/edit-plan` … 編集計画、レポート、承認、生成
- `/overlay-authoring` … テロップ、図、3D などの画面要素の制作
- `/setup-library` … 素材ライブラリの準備
- `/harvest-asset` … 素材の収集
- `/bake-3d` … 3D 素材の焼き込み

Codex 等のハーネスでは `.agents/skills/` / `.codex/skills/`（`.claude/skills/` への symlink）から
同じスキルが自動発見される。

スキルを自動で読まない作業環境では、次のプロジェクト内相対パスから手順を直接読む。

- `.claude/skills/analyze-footage/SKILL.md`
- `.claude/skills/edit-plan/SKILL.md`
- `.claude/skills/overlay-authoring/SKILL.md`
- `.claude/skills/setup-library/SKILL.md`
- `.claude/skills/harvest-asset/SKILL.md`
- `.claude/skills/bake-3d/SKILL.md`

分析結果と節目の記録の詳しい約束は
`.claude/skills/analyze-footage/references/akari-data-contract.md` を参照する。

利用者へ説明するときは日本語を使い、内部の仕組みの名前ではなく、
「変更履歴」「企画メモ」「素材」など役割が伝わる言葉を使う。

この案内はこのプロジェクトのものです。運用に合わせて自由に書き換えて構いません。
