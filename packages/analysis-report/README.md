# @akari-video/analysis-report

分析レポート v1（テンプレ + データ分離・読み取り専用）。外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ）。

契約: `planning/contract-2026-07-22-analysis-report.md`（内部リポ）§2 / タスク
`tasks/2026-07-22-analysis-report-template/task.md`（内部リポ）。

## 構成

| ファイル | 役割 |
|---|---|
| `template.html` | UI 正本（不変）。データを一切含まない。`<script type="application/json" id="akari-analysis-report-data">` にプレースホルダーを持ち、描画ロジック（章⇄構成案の対応付け・空状態文言・事実/解釈バッジ）はすべてこのファイル内の inline script が担う |
| `render-analysis-report.mjs` | zero-dep CLI。analysis.json（事実層・複数可）+ interpretation.json（解釈層）を検証し、生データをそのまま JSON として template.html へ埋め込む |
| `test/` | fixtures（最小の有効/無効サンプル）+ node:test によるスモークテスト |

## 使い方

```sh
node packages/analysis-report/render-analysis-report.mjs \
  --analysis <analysis.json のパス> [--analysis <analysis.json のパス> ...] \
  --interpretation <interpretation.json のパス> \
  --out <report.html の出力先>
```

- `--analysis` は `interpretation.json` の `assets[]` と **同数・同順**で指定する
  （i 番目の `--analysis` が `assets[i]` に対応する。v0 の位置的対応づけ規約 — schema には
  asset ↔ analysis の明示的な外部キーが無いため、CLI 呼び出し順を SSOT とする）
- `interpretation.json` は `packages/schemas/bin/validate-interpretation.mjs` で検証し、
  PASS しない場合は明確なエラーを出して **何も書き出さずに** 終了する（exit code 1）
- `analysis.json` は軽量な構造検証（zero-dep 方針のため ajv 等は使わない）で明らかな壊れ入力を拒否する
- keyframe 画像は実在確認した上で相対パスとして参照する（`data:` への焼き込みはしない —
  画像を焼き込むと v2/v3 系のように HTML が数百 KB〜数十 MB に肥大化するため）。存在しなければ
  `template.html` 側が note テキストのチップへ自動的に縮退する

## 設計原則

- **テンプレ + データ分離**: レンダラーはデータの検証・束ねのみを行い、章とアークの対応付け・
  trouble_overlap の節 3/5 振り分け・空状態文言などの表示ロジックは一切持たない。
  それらはすべて `template.html` の inline script が担う。schema が進化しても
  テンプレ側の更新だけで追随できるようにするため
- **読み取り専用**: 決定 UI（選択肢・ツマミ・確定ボタン）は一切持たない。方向性の判断はチャットで行う
- **事実 / 解釈の分離を可視化**: 全カードに 事実 / 解釈 のバッジを付け、解釈側は
  `arc[].evidence` / `flags[].evidence` をそのまま「根拠を見る」で開示する
