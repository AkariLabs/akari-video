# このプロジェクトのスキル

AKARI Video の編集スキルは、このフォルダーに実体で入っています。
プロジェクトをフォルダーごと複製しても、同じスキルをそのまま利用できます。

`.claude/skills/` 配下の全ディレクトリがそのまま使えます。主なもの:

- `/analyze-footage` … 素材ごとの内容を分析します。
- `/analyze-project` … 複数素材とプロジェクト全体の文脈をまとめて分析します。
- `/edit-plan` … 編集計画を作り、承認後の編集内容へ反映します。
- `/overlay-authoring` … テロップ、図、3D などの画面要素を制作します。
- `/edit-lint` … 編集結果を機械的に検査し、仕上がりの確認を支えます。
- `/render-cut` … 承認済みの編集を書き出し、完成ファイルを検証します。
- `/setup-library` … 利用できる素材を準備します。
- `/address-review` … 未対応のレビュー指摘を編集へ反映します。

各スキルの手順は `.claude/skills/<スキル名>/SKILL.md` にあります。
スキルを自動で読まない作業環境でも、このプロジェクト内相対パスから直接読めます。
分析結果と節目の記録の詳しい約束は
`.claude/skills/analyze-footage/references/akari-data-contract.md` を参照してください。

`.agents/skills/`、`.cursor/skills/`、`.codex/skills/` は Codex / Cursor など他の AI エージェント用の入り口で、
このフォルダーの実体への symlink です。

`AKARI-SKILLS-VERSION` は、このプロジェクトを作ったときのスキル内容を示す記録です。
既存プロジェクトのスキルが後から自動で置き換わることはありません。

この案内と各スキルは、このプロジェクトのものです。運用に合わせて自由に書き換えて構いません。
