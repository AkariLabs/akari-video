# プロジェクト構成 — .akari/ の中身を知る

AKARI Video のプロジェクトは「ファイル契約」で動きます。エージェント・アプリ・人間が
同じファイルを読み書きすることで、どの入口からでも同じ状態に到達できます。
このページは日常で目にするファイルの役割一覧です（正確なスキーマは
[Reference](../README.md#reference) を参照）。

## プロジェクトルート直下

| ファイル | 役割 |
|---|---|
| `edit.json` | **編集のセーブデータ（SSOT）**。カット・オーバーレイ・音声・ビート・演出 |
| `captions.json` | 字幕データ |
| `review.json` | レビュー注釈（チケット）のサイドカー |

ルート直下に置いてよい生成物はこの契約ファイルだけです。それ以外の生成物は
役割ごとの置き場に入ります（散らかさない規約）。

## ディレクトリ

| 場所 | 役割 |
|---|---|
| `assets/` | 素材置き場（`assets/<カテゴリ>/<id>/` + meta.json） |
| `planning/` | 企画・計画文書（research-plan.json / plan.json / decision-log.md） |
| `exports/` | 書き出し先 |

## .akari/ 配下

| ファイル / ディレクトリ | 役割 |
|---|---|
| `.akari/intake.json` | 進め方フォーム（やること / 尺 / おまかせ度） |
| `.akari/connections.json` | 接続レジストリ（API キー参照・モデル選択・コスト承認ポリシー） |
| `.akari/workflow.json` | プロジェクトのロール定義 |
| `.akari/sidecars/` | 素材ごとの `analysis.json`（分析の事実層） |
| `.akari/events/` | 節目の記録（1 件ずつ追記。「続きから」の合図） |
| `.akari/lint.json` | edit-lint の検査結果の正本 |
| `.akari/render.json` | 書き出しの計画・実行結果の正本 |
| `.akari/diffs/` | 人間 → AI の差分協調の置き場 |
| `.akari/work/` | エージェントの中間物（**削除安全** — 再生成できる） |
| `.akari/reports/` | 検証証跡・レポート HTML（**削除しない** — 人間確認の記録） |
| `.akari/cache/` | サムネ・プロキシ等のキャッシュ（削除安全） |

## 削除していいもの・いけないもの

- `.akari/work/`・`.akari/cache/` — 消しても再生成されます
- `.akari/reports/` — 「人間が何を確認したか」の証跡なので消さない
- `edit.json`・`.akari/events/` — プロジェクトの記憶そのもの。git 管理を推奨

## プロジェクトの外にあるもの

| 場所 | 役割 |
|---|---|
| `~/.config/akari-video/credentials.env` | API キーの実体（プロジェクトに入れない） |
| `~/.akari-video/assets/` | 個人スコープの素材ライブラリ |

## git との相性

セーブデータはすべてテキスト（JSON / HTML）なので、コミットすれば編集履歴が
そのままバージョン管理になります。「昨日の編集に戻して」が `git diff` と revert で成立します。
