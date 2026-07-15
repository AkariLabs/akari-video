# docs — 設計文書

AKARI Video 新実装（本モノレポ）の設計・契約文書。旧実装 `akari-video-tauri`
（Rust/Tauri v2 シェル、参照実装）の `docs/planning/` から選別インポートした
9 本を収録する（2026-07-15、Wave I-5）。

**正典は本リポ。** 旧実装（Tauri シェル）固有の実装詳細に踏み込む文書・節は
`akari-video-tauri/docs/planning/` に残置されている（本リポには移送していない）。
移送済みの契約のうち Tauri/IPC 実装詳細を含んでいたものは、該当節を「legacy 実装note」
として本文末に隔離または注記した（下表の備考を参照）。

## 目次

| ファイル | 内容 |
|---|---|
| [design-2026-07-13-agent-native-architecture.md](./design-2026-07-13-agent-native-architecture.md) | agent-native アーキテクチャの思想の正本（サンドイッチ3層構成・編集モデル・MVPマイルストーン） |
| [contract-2026-07-13-m1-m4.md](./contract-2026-07-13-m1-m4.md) | edit.json スキーマ v0 の確定契約。旧 Tauri シェルの M1〜M4 実装詳細（IPC・ファイル所有権等）は文末に legacy 実装noteとして隔離 |
| [contract-2026-07-13-asset-library.md](./contract-2026-07-13-asset-library.md) | 素材ライブラリ契約 v0（meta.json スキーマ・入庫基準・catalog/取得スキル・スコープ階層） |
| [contract-2026-07-13-m5-analysis-report.md](./contract-2026-07-13-m5-analysis-report.md) | M5 契約 v0 — 分析パイプライン（analysis.json）+ 編集判断レポート + 生成スキル |
| [contract-2026-07-14-3d-bake-recipe.md](./contract-2026-07-14-3d-bake-recipe.md) | 3D ベイクレシピ契約 v0（Blender 経路。scene.py・knobs・実行契約・容量規律） |
| [contract-2026-07-14-edit-json-v1-crop.md](./contract-2026-07-14-edit-json-v1-crop.md) | edit.json v1 crop（リフレーミング）契約。`cuts[].crop` フィールドの確定スキーマ |
| [contract-2026-07-14-edit-json-v1-audio.md](./contract-2026-07-14-edit-json-v1-audio.md) | edit.json v1 音声スキーマ契約（`audio.bgm` / `audio.sfx`）。Tauri 実装への言及 3 件を legacy 注記化 |
| [notes-2026-07-13-edit-json-v1.md](./notes-2026-07-13-edit-json-v1.md) | edit.json v1 拡張の方向性メモ（出力プロファイル複数化・crop・レイアウト・音声・サムネ枠の初期案） |
| [notes-2026-07-14-captions-and-cut-editing.md](./notes-2026-07-14-captions-and-cut-editing.md) | 字幕とカット編集の方向性メモ（word 精度カット提案・captions 第一級化・カラオケ表示・強調字幕） |
| [notes-2026-07-16-qa-lint-and-transcript-ui.md](./notes-2026-07-16-qa-lint-and-transcript-ui.md) | 自己検証ループとトランスクリプト編集 UI の方向性メモ（edit-lint・words confidence・視覚検索トリガー・Monaco MVP / リッチ UI 二段構え。外部設計対話レビューの採否記録含む） |
| [notes-2026-07-16-headless-first-and-diff-collaboration.md](./notes-2026-07-16-headless-first-and-diff-collaboration.md) | ヘッドレス CLI 完結と差分協調の方向性メモ（アプリ不要経路の不変条件化・HTML レポートの根拠・状態差分による人間→AI 伝達・git コミット粒度・リモートパイプライン構想と遠隔 MVP） |

## 移送対象外（判断保留）

`akari-video-tauri/docs/planning/` には他に `notes-2026-07-14-export-fast-path.md`
（書き出し高速化。非移送の Rust 実装を名指しするため編集前提・判断保留中）と
`notes-2026-07-14-viewer-ui-round.md`（旧 UI ファイル名に直結。判断保留中）が残る。
いずれも移送タスクの判断事項として棚卸し正本
（`akari-video-internal/tasks/2026-07-15-import-inventory/report.md`）に記載済み。
