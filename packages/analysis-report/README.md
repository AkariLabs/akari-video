# @akari-video/analysis-report

分析レポート v1（テンプレ + データ分離・読み取り専用）。外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ）。

契約・タスク定義は内部リポ `akari-video-internal`（非公開）で管理。

## 構成

| ファイル | 役割 |
|---|---|
| `template.html` | UI 正本（不変）。データを一切含まない。`<script type="application/json" id="akari-analysis-report-data">` にプレースホルダーを持ち、描画ロジック（章の折りたたみ・空状態文言・事実/解釈バッジ）はすべてこのファイル内の inline script が担う |
| `render-analysis-report.mjs` | zero-dep CLI。analysis.json（事実層・複数可）+ interpretation.json（解釈層）を検証し、生データをそのまま JSON として template.html へ埋め込む |
| `test/` | fixtures（最小の有効/無効サンプル）+ node:test によるスモークテスト |

## 使い方

```sh
node packages/analysis-report/render-analysis-report.mjs \
  --analysis <ref>=<analysis.json のパス> [--analysis <ref>=<パス> ...] \
  --interpretation <interpretation.json のパス> \
  --out <report.html の出力先>
```

- `--analysis` の正式形は `<ref>=<path>`（`ref` は `interpretation.json` の
  `assets[].ref` を明示する）。**位置対応づけ（v0 初期の「同数・同順」規約）は廃止した**
  （2026-07-22 改訂 — multiasset-dogfood A3.2 で、`--analysis` の指定順を入れ替えても
  無警告で `assets[].ref` と analysis.json の中身が入れ替わる silent data corruption を実証。
  `inputs.analyses[].ref` を schema 側で必須化し、CLI 側も ref 結合に切り替えた）
  - 素の `<path>` のみの指定も許容するが、`interpretation.json` の
    `inputs.analyses[].path` と **一意に**照合できる場合に限る（basename または
    path segment の末尾一致が 1 件に定まる場合）。不一致・複数一致（曖昧）はどちらも
    ハードエラーで **何も書き出さない**。順序へのフォールバックはしない
  - どちらの指定形でも、確定した `ref` に対応する `inputs.analyses[].path` と、CLI で
    与えた path が対応しているかを追加でクロスチェックする（取り違えたペアを
    明示的な `ref=path` で渡した場合もここで検出する）
  - `interpretation.assets[]` の全 `ref` に対応する `--analysis` が過不足なく必要
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
  `relations[].evidence` / `flags[].evidence` をそのまま「根拠を見る」で開示する
- **構成案（`interpretation.json` の `arc`）はレポート表示から除去**（2026-07-22
  改訂）。対話フェーズで AI がチャットで提案する種として interpretation.json の
  データには残るが、レポートは「対話前の事実 + 素材の読み」に限定する（詳細は
  内部リポの契約を参照）
