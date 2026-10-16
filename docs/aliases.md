# 別名表（旧名 → 新名。読み取りは永続）

> 正本: `contract-2026-10-16-vocabulary-v0.md` §10。画面の語を変えても id・キー・URL・タイルの key は変えない。旧名は**読み取り永続**、CLI の旧フラグは使われたら案内を 1 行出すだけ。消す版はここでは決めない。
> 列: 旧 / 新 / 種類（表示・CLI フラグ・サブコマンド・i18n キー・データ値・タイル key）/ 場所 / 互換の扱い / 根拠

| 旧 | 新 | 種類 | 場所 | 互換の扱い | 根拠 |
|---|---|---|---|---|---|
| `akari new --template <path>` | `akari new --scaffold <path>` | CLI フラグ | `packages/akari-launcher/src/new-command.mjs` | 旧は永続の別名。両方渡したら誤り。使われたら案内 1 行 | vocabulary-v0 §6 |
| `akari playbook template …` | `akari template export …` | CLI サブコマンド | `playbook-command.mjs` / `template-command.mjs`（新） | 旧は永続の別名 | vocabulary-v0 §6・template-v0 §6 |
| 作り方（Playbook）から | 作り方から | 表示 | `surfaces.home.startFromPlaybook.button` | 値だけ変更。キー不変 | vocabulary-v0 §8 |
| ひな形 / 雛形 / テンプレート（ライブラリの同じタイル） | テンプレート | 表示 | `library-home-view.ts` タイル key `template`（不変）・`project.library.home.templateCategoryLabel` | 値だけ変更。key 不変 | vocabulary-v0 §8 |
| テンプレから（企画書の下書き） | 型 | 表示 | `surfaces.home.projectHomeTemplate.label`・`homeDialogChooseTemplate.heading` | 値だけ変更 | vocabulary-v0 §8 |
| テンプレ（字幕の見た目） | 字幕スタイル | 表示 | `transcript.daihon.editor.templateLabel` ほか transcript 8 件 | 値だけ変更 | vocabulary-v0 §8 |
| 雛形からプロジェクトを新規作成（CLI usage） | 空のプロジェクトを新規作成 | 表示 | `cli.help.developer.new`・`cli.new.*` | 値だけ変更 | vocabulary-v0 §8 |
| 使用した雛形（レポート） | 使った土台 | 表示 | `report-project.meta.template.label` | 値だけ変更 | vocabulary-v0 §8 |
| ひな形から始める（動きのプリセット） | スタイルから始める | 表示 | `inspector.animatorSection.label.startFromTemplate` | 値だけ変更 | vocabulary-v0 §8 |
| この作り方で作り直す | 同じ設定で作り直す | 表示 | `annotations.inspectorWidget.text.howToMake` 付近 | 値だけ変更 | vocabulary-v0 §1 |
| マイスタイル / 保存したプリセット | 自分のスタイル | 表示 | タイル key `mypresets`（不変）・`project.library.pane.myStylesLabel`・`savedPresetsLabel`・`kind: 'mystyle'`（不変） | 値だけ変更 | vocabulary-v0 §8 |
| オーバーレイ | 動く部品 | 表示 | `project.catalog.category.overlayLabel` ほか 17 件。`category: overlay`（不変） | 値だけ変更 | vocabulary-v0 §8 |
| 焼いた（素材の絞り込み） | ほか / 3D | 表示 | `project.workspace.materialChips.bakedLabel` | 値だけ変更（レーン 2026-10-16-materials-filter-merge） | オーナー 2026-10-16 |
| レシピ（素材の絞り込み・接続の「3D レシピ」） | 画面に出さない / 3D の設定 | 表示 | `project.workspace.materialChips.recipeLabel`・`connect.catalog.connector.recipesLabel` | 値だけ変更。`kind: akari-recipe`・`akari recipe` 不変 | vocabulary-v0 §1（recipes-and-connectors-v0 §6 を上書き） |
| ブランドキット | チャンネルの設定 | 表示 | `inspector.colorPanel.label.brandKit`・`project.library.home.brandKitLabel`・タイル key `brandkit`（不変）・`brand-kit.json`（不変） | 値だけ変更 | オーナー 2026-10-16 |
| セット / パック（ライブラリのタイル） | 出さない（Lab の売り方だけ） | 表示 | タイル key `pack`（不変）・`setLabel` / `packsLabel` | タイルは非表示にするか Lab への導線にする。key 不変 | vocabulary-v0 §1 |
| `example: true`（playbook.json） | 変えない | データ値 | playbook-v0 §2 | 既存値不変。移行表が確定してから個別に | vocabulary-v0 §8 |
| 記憶パック（チャンネルの人物 / 単語帳） | 記憶（人物 / 単語帳）。束は「記憶の束」 | 表示 | `surfaces.channel.memoryPackCatalog*`（キー不変） | 値だけ変更 | vocabulary-v0 §11-5 |
| 作り方の例 / Playbook examples（Lab） | 作例 / Showcases | 表示 | `akari-video-store` index.html・`i18n/en.json` | 値だけ変更。id `example-*` 不変（動画の無い物は「作り方」のまま） | vocabulary-v0 §11-1 |
