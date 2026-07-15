# akari-video — AKARI Video モノレポ（ドラフト・要オーナーレビュー）

> AI 動画編集ツール「AKARI Video」の製品モノレポ。**private スタート**
> （公開はコンテンツが検収済みで揃った公開タイミングでまとめて — internal §0 原則）。
> 旧 Tauri 実装: `akari-video/akari-video-tauri`（レガシー参照・public のまま）
> 内部文脈（戦略・調査・運用記録）: `akari-video-internal`（非公開）

## 構造

| ディレクトリ | 内容 |
|---|---|
| `apps/shell/` | Theia ベースのシェル本体（タブ + ツリー + 右パートナー + 4 アイコン） |
| `packages/` | シェル非依存ライブラリ（schemas / preview-engine / サーフェスランタイム / decision-cards） |
| `skills/` | ステージスキル（調査・企画・編集・QA。ステージはアプリ機能にしない） |
| `templates/` | プロジェクト雛形（英語正準: assets/ planning/ exports/ + CLAUDE.md + AGENTS.md + .akari/ + .claude/） |
| `catalog/` | 🧩 キュレーションカタログ定義（**参照配布のみ** — メタデータ・ツマミ宣言・プレビュー。実体バイナリは置かない） |
| `docs/` | 設計文書（シェル非依存のものを internal / legacy から選別移送） |

## 設計の不変条件（正本は internal の契約群）

- **ファイル契約が結合の全て**: アプリ⇄エージェント間に IPC を置かない。
  タブ = ファイル + サイドカー、応答 = decisions.json / review.json / git diff の 3 チャネル
- **ハーネス非依存**: エージェント統合は PTY + ファイル契約。Claude Code / Codex どちらでも動く
- **ステージを実装しない**: ステージ = スキル + サーフェス規約。アプリは汎用基盤 4 点のみ
- **モードスイッチは developer mode の 1 個だけ**。モードを増やさない
- 拡張の導入は **namespace/ID ピン留め**（Open VSX 検索は使わない）+ プラットフォーム別バイナリ検証

## 規約

- コミット: 日本語本文 + プレフィックス（`[機能追加]` `[修正]` `[ドキュメント]` 等）
- 販売予定・非公開素材はこのリポに置かない（実体は私有領域、ここには参照のみ）
- Secrets を書かない（.env 系は別管理）
- 選別インポート中: 由来（legacy パス）をコミット本文に記録する
