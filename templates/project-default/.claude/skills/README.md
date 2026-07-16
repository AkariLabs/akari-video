# このプロジェクトのスキル

AKARI Video のステージスキル（analyze-footage / edit-plan / overlay-authoring /
setup-library / harvest-asset / bake-3d）は、アプリ本体が **プラグインとして供給** します。
アプリでこのプロジェクトを開き、右パートナーを起動すると、これらは `akari-video:` 名前空間で
読み込まれます（例: `akari-video:analyze-footage`）。

スキルの実体は各プロジェクトへコピーされず、アプリが共有ストアで一元管理します。そのため
アプリを更新すると、既存プロジェクトにも新しいスキルが即座に反映されます。

## ローカル上書き

このプロジェクト専用にスキルを差し替えたいときは、`.claude/skills/<スキル名>/SKILL.md` を置きます。
素の名前（例: `analyze-footage`）はプロジェクト側が優先され、アプリ供給版
（`akari-video:analyze-footage`）はそのまま併存します。プロジェクトの上書きが常に勝つので、
共有版を壊さずに、このプロジェクトだけ手順を調整できます。

## スキル文書を直接読む場合

アプリのスキル機構を使わないエージェント（Codex など）は、`AGENTS.md` に記載の共有ストアのパス

    ~/Library/Application Support/@akari-video/shared/skills/

から SKILL.md を直接読んでください。ワークフローの節目には `.akari/events/` にイベントを
1 件ずつ着地させます（書式は共有ストア内 `edit-plan/references/event.example.json` を参照）。
