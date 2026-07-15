# @akari-video/decision-cards

編集判断レポートを「決定カードの積み重ね + ポチポチ回答」にするための v0 ランタイム。
外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ）。

## 構成

| ファイル | 役割 |
|---|---|
| `report-helper.mjs` | `127.0.0.1` のみにバインドするローカル HTTP ヘルパー。`report.html` の配信・`decisions.json` の read/write・commit を仲介する |
| `report-template.html` | data 属性でカードを宣言する report.html の雛形。カード種別のハードコードなし。ヘルパー経由なら操作可能、`file://` 直開き等で fetch 失敗時は全操作ボタンが disabled になり案内文言を出す（安全劣化） |
| `examples/report.html` + `examples/report.html.decisions.json` | 動作サンプル一式（カード 4 枚: `thumbnail` / `cut-policy` / `captions-policy` / `structure`）。AI 推奨を既定値に入れた `decisions.json` 雛形付き |

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

`examples/` 配下は legacy との diff ゼロで保つため、動作確認は作業コピー
（例: スクラッチディレクトリへコピーしたもの）に対して行うこと。

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
