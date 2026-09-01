[English](./project-structure.md) | **日本語**

# プロジェクト構成 — .akari/ の中身を知る

AKARI Video のプロジェクトは「ファイル契約」で動きます。エージェント・アプリ・人間が
同じファイルを読み書きすることで、どの入口からでも同じ状態に到達できます。
このページは日常で目にするファイルの役割一覧です（正確なスキーマは
[Reference](../README.ja.md#reference) を参照）。

## プロジェクトルート直下

| ファイル | 役割 |
|---|---|
| `edit.json` | **編集のセーブデータ（SSOT）**。カット・オーバーレイ・音声・ビート・演出 |
| `captions.json` | 字幕データ |
| `review.json` | レビュー注釈（チケット）のサイドカー |
| `decision-log.md` | analyze-project と edit-plan が共有する追記専用の判断履歴 |
| `analysis-report.html` | analyze-project が生成する素材横断の正式な分析レポート |

ルート直下に置いてよい生成物はこの契約ファイルだけです。それ以外の生成物は
役割ごとの置き場に入ります（散らかさない規約）。

## ディレクトリ

| 場所 | 役割 |
|---|---|
| `assets/` | 素材置き場（`assets/<カテゴリ>/<id>/` + meta.json） |
| `planning/` | 企画・計画文書（research-plan.json / plan.json） |
| `exports/` | 書き出し先 |
| `motion/` | edit.json から参照するキーフレーム曲線の**正本**（再生成不可） |

## .akari/ 配下

| ファイル / ディレクトリ | 役割 |
|---|---|
| `.akari/intake.json` | 進め方フォーム（やること / 尺 / おまかせ度）。`title`（人間向け表示名。フォルダ名とは別）は企画（intake）が決まった時点でエージェントが書く — フォーム入力の対象はまだ無い |
| `.akari/connections.json` | 接続レジストリ（API キー参照・モデル選択・コスト承認ポリシー） |
| `.akari/workflow.json` | プロジェクトのロール定義 |
| `.akari/sidecars/` | 素材ごとの `analysis.json`（分析の事実層） |
| `.akari/events/` | 節目の記録（1 件ずつ追記。「続きから」の合図） |
| `.akari/lint.json` | edit-lint の検査結果の正本 |
| `.akari/render.json` | 書き出しの計画・実行結果の正本 |
| `.akari/diffs/` | 「変更を見る」で生成される比較用スナップショット |
| `.akari/render-tmp/` | 書き出し中に使う一時作業領域 |
| `.akari/work/` | エージェントの作業領域。使い捨ては `tmp/`、作り直せないものは `keep/` に置く |
| `.akari/reports/` | 検証証跡・レポート HTML（**削除しない** — 人間確認の記録） |
| `.akari/cache/` | サムネ・プロキシ等のキャッシュ（削除安全） |

## 削除していいもの・いけないもの

`akari clean [project-dir]` を実行すると、削除可能・保持・判断保留を容量付きで一覧できます。
既定は一覧のみです。`--yes`（または対話での承認）の後も削除可能なものだけを削除し、直近に
更新された候補とシンボリックリンクは判断保留のまま残します。

- `.akari/cache/`・`.akari/render-tmp/`・生成された差分・書き出し中間物は、実行中でなければ
  削除可能として一覧されます
- `.akari/work/` では、使い捨てを `tmp/`、計画・生成器・手編集ファイル等を `keep/` に置きます。
  空の目印 `.akari-disposable` / `.akari-keep` は置いたディレクトリ配下に効き、keep が優先です。
  目印のない既存内容は判断保留になります
- `.akari/reports/`・`motion/`・`assets/`・`edit.json`・`.akari/events/` は、証跡・原本・
  プロジェクトの記憶なので保持します。git 管理を推奨します

## プロジェクトの外にあるもの

| 場所 | 役割 |
|---|---|
| `~/.config/akari-video/credentials.env` | API キーの実体（プロジェクトに入れない） |
| `~/.akari-video/assets/` | 個人スコープの素材ライブラリ |

## git との相性

セーブデータはすべてテキスト（JSON / HTML）なので、コミットすれば編集履歴が
そのままバージョン管理になります。「昨日の編集に戻して」が `git diff` と revert で成立します。
