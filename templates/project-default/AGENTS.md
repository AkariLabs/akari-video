# AKARI Video プロジェクトの進め方

- 元動画は `assets/`、企画・レポートは `planning/`、完成した動画は `exports/` に置く。英語の正準名は変えない。
- 素材の分析結果は `.akari/sidecars/<assets 以下の相対パス>.meta.json` に保存する。
- ワークフローの節目は `.akari/events/` に不変 JSON を 1 件ずつ着地させる（既存イベントは編集・削除しない）。

## スキル文書の場所（アプリのスキル機構を読まないエージェント向けの縮退経路）

AKARI Video が供給するスキルの本体は、アプリの共有ストアに一元管理されています:

    ~/Library/Application Support/@akari-video/shared/skills/<スキル名>/SKILL.md

Codex などスキル機構を読まないレーンは、上のパスから SKILL.md を直接読んで手順に従ってください。主なスキル:

- `analyze-footage` … 素材 1 本の分析（720p プロキシ・ローカル文字起こし・キーフレーム・analysis.json）
- `edit-plan` … 編集計画とレポート、承認、生成
- `overlay-authoring` … テロップ・図・3D などのオーバーレイ制作
- `setup-library` / `harvest-asset` / `bake-3d` … 素材ライブラリ整備・素材収集・3D 焼き込み

`.akari/` のデータ契約の詳細は `analyze-footage/references/akari-data-contract.md`（共有ストア内）を参照。
