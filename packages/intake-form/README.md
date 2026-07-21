# @akari-video/intake-form

進め方フォーム（intake サーフェス）の standalone ブラウザ版。アプリなし運用
（`packages/decision-cards` と同じ流儀: 外部 npm 依存ゼロ・`127.0.0.1` のみ）でも
`.akari/intake.json` を読み書きできる。

## 構成

| ファイル | 役割 |
|---|---|
| `intake-form-server.mjs` | `createIntakeFormServer(projectRoot)` — リッスンしない `http.Server` を返す。テスト/CLI から使い回す |
| `intake-form-helper.mjs` | CLI ラッパー（`bin: intake-form-helper`）。引数をパースしてサーバを起動する |
| `intake-form-template.html` | フォーム本体（静的 HTML + インライン JS）。`packages/schemas/intake.schema.json` の `x-akari-labels` の手動ミラー（同期は手動 — 既知の制約） |
| `test/intake-form-server.test.mjs` | サーバが書き込む `intake.json` が `packages/schemas/bin/validate-intake.mjs` を通ることを含めた smoke test |

## 使い方

```sh
node packages/intake-form/intake-form-helper.mjs <プロジェクトルート> [--port N]
```

起動すると `intake-form: http://127.0.0.1:<port>/  (project: ...)` を標準出力に出す。
ブラウザでそれを開くとフォームが表示され、送信すると `<プロジェクトルート>/.akari/intake.json` へ
`status: "submitted"` で書き込まれる。

### エンドポイント

- `GET /` — `intake-form-template.html` を配信
- `GET /api/state` — `.akari/intake.json` を読む（無ければ 404）
- `POST /api/state` — `.akari/intake.json` へ全文書き込み（`.akari/` が無ければ作成する）

### アプリ内サーフェスとの関係

アプリ内（Theia シェル）のホーム v2 は同じ内容を React ウィジェットとして実装している
（`apps/shell/extensions/akari-surfaces/src/browser/akari-home-widget.tsx` の 03 進め方
フォーム）。両者は同じ `.akari/intake.json` を対象にし、ラベル文言も揃えているが、
実装（レンダリング経路）自体は独立している — アプリが無い環境でもこのパッケージ単体で
進め方を決めて `.akari/intake.json` を作れることを壊さないための構成。

## テスト

```sh
node --test packages/intake-form/test/*.mjs
```
