# AKARI Video プロジェクト

このプロジェクトでは、元動画を `assets/`、企画とレポートを `planning/`、完成した動画を
`exports/` に置きます。画面表示上の日本語名が変わっても、実ファイルの英語名は変更しません。

`.akari/workflow.json` が役割と表示の契約です。素材の分析結果は
`.akari/sidecars/<assets 以下の相対パス>.meta.json` に保存し、ユーザーの操作イベントは
`.akari/events/` に JSON として着地させます。詳細は `.claude/skills/README.md` を参照してください。
