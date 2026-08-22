# @akari-video/decision-cards

編集判断レポートを「決定カードの積み重ね + ポチポチ回答」にするための v0 ランタイム。
外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ）。

## 構成

| ファイル | 役割 |
|---|---|
| `report-helper.mjs` | `127.0.0.1` のみにバインドするローカル HTTP ヘルパー。`report.html` の配信・`decisions.json` の read/write・commit を仲介する |
| `report-template.html` | data 属性でカードを宣言する report.html の雛形。単選・真偽チェック・整数スライダ・配列型の複数選択に対応する。カード種別のハードコードなし。ヘルパー経由なら操作可能、`file://` 直開き等で fetch 失敗時は全操作ボタンが disabled になり案内文言を出す（安全劣化） |
| `render-research-plan-report.mjs` | `research-plan.json` から固定 5 面の自己完結 HTML を生成する。絵コンテ面は画像 / 文字プレースホルダーのカード面と、主軸 + カットアウェイの読み取り専用 SVG 構造面を切り替えられる |
| `examples/report.html` + `examples/report.html.decisions.json` | 動作サンプル一式（既存 4 カード + `direction`）。AI 推奨を既定値に入れた `decisions.json` 雛形付き |
| `test/direction-card.test.mjs` | ローカル Chrome を headless 起動して、演出カードの保存と既存 4 カードの非退行を実測するテスト |

## 使い方

```sh
node packages/decision-cards/report-helper.mjs <report.html のパス> [--port N]
```

起動すると `HELPER: http://localhost:<port>/` を標準出力に出す。ブラウザでそれを開くと
`report.html` が配信され、カード操作のたびに `<report.html>.decisions.json` へ全文書き込みされる。

### エンドポイント

- `GET /` — `report.html` を配信
- `GET /api/state` — `decisions.json` を読む（無ければ 404）
- `POST /api/state` — `decisions.json` へ全文 idempotent 書き込み。`createdAt` は既存値を保持し、
  `completedAt` はリクエスト body の値を無視して既存値を保持する（`commit` のみが記入する）
- `POST /api/commit` — `completedAt` を記入して確定する。`decisions.json` が無ければ 404、
  既に確定済み（`completedAt` が非 null）なら 409
- それ以外の `GET` — report ディレクトリ配下の静的ファイル配信（パストラバーサルは 403）

### 動作サンプルで試す

```sh
node packages/decision-cards/report-helper.mjs packages/decision-cards/examples/report.html --port 8791
# 別ターミナルで
curl http://127.0.0.1:8791/api/state
curl -X POST http://127.0.0.1:8791/api/commit
```

`examples/` 配下の decisions.json を実操作で変更しないため、動作確認は作業コピー
（例: スクラッチディレクトリへコピーしたもの）に対して行うこと。ブラウザテストも一時領域へ
サンプル一式をコピーしてから操作する。

### カード入力の data 属性

- `data-option` + `data-answer-key`: 単選値を指定した answer キーへ保存する。`data-answer-key` 省略時は既存どおり answer 内の対応値を自動検出する
- `data-range="<key>"` + `data-default-value`: range の値を整数化し、answer の `<key>` へ保存する。対応する `data-range-value="<key>"` に現在値を表示する
- `data-array-check="<key>"` + `data-array-value="<value>"`: 複数選択を answer の配列へ保存する。`data-default="true"` の項目は既定で選択する

```sh
npm test --workspace @akari-video/decision-cards
```

### research-plan のビジュアル絵コンテ

```sh
node packages/decision-cards/render-research-plan-report.mjs \
  planning/research-plan.json \
  planning/research-plan-report.html
node packages/decision-cards/report-helper.mjs planning/research-plan-report.html
```

画像は生成時に data URI へ埋め込むため、出力 HTML は外部依存を持たない。`image_path` が無い、または画像を読めないショットは `shot_type` + `description` のプレースホルダーへ安全に劣化する。旧形式に `sequence` / `cutaway_of` が無い場合も生成は成功し、構造面だけが「構造情報なし」になる。

## edit-plan スキルからの参照方法

公開リポの `.claude/skills/edit-plan/` は本パッケージを以下のように参照する想定:

- `report-guide.md` / `workflow.md` から `report-template.html` をレポート生成の雛形として参照する
- `execution.md`（または同等の実行手順書）が
  `node packages/decision-cards/report-helper.mjs <レポートパス>` を起動コマンドとして案内し、
  `decisions.json` の `completedAt` が非 null になるまで待つ運用を記述する
- スキル側からの相対パス参照はモノレポのルートからの相対（`packages/decision-cards/...`）を
  前提にする。スキル配下に本パッケージのファイルを複製しない（SSOT はこのパッケージ）

## 実装ノート

- 依存ゼロ・Node.js 組み込みモジュール（`node:http` / `node:fs` / `node:path` / `node:crypto`）のみ
- 書き込みは一時ファイル + `rename` によるアトミック置換。書き込み中の破損を避ける
- `report` ディレクトリ外への読み書きは一切行わない（`isInside` によるパス検証 + `realpath` 突合）
