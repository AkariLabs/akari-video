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

## block-id スキーム（doc:\<path\>#\<block-id\> 注釈ターゲットの地ならし）

内部契約 `contract-2026-07-26-doc-image-annotations.md` §1 が課す block-id の 3 要件
（**データ由来・再生成安定・文書内一意**）を満たすため、`render-analysis-report.mjs`
側の純関数（`buildBlocksManifest`）が各対象ブロックの id を導出し、生データ
（`#akari-analysis-report-data`）とは別の
`<script type="application/json" id="akari-analysis-report-blocks">` へ
「blocks マニフェスト」として埋め込む。生データの `<script>` ブロックには一切手を入れない
（「生データをそのまま埋め込む」原則を保つため）。`template.html` の inline script は
このマニフェストを参照して各ブロック DOM に `data-block-id` 属性を付与するだけで、
id の値そのものを新規に作り出すことはしない（SSOT は CLI 側）。

- **文書内衝突はハードエラー**: id が重複する入力は `render-analysis-report.mjs` が
  `block-id が文書内で衝突しています: <id>, ...` で拒否し、**何も書き出さない**
  （既存 renderer の「曖昧・不一致は何も書き出さない」哲学と同じ）
- **id 文字列の形**: `<kind>:<segment>[:<segment>...]`。`kind` はブロック種別を表す
  固定の英語 slug（下表）、各 `segment` はデータ由来の値を `encodeURIComponent` で
  percent-encode したもの。`encodeURIComponent` は `#` を含め URL fragment 上で
  意味を持つ文字を必ずエンコードするため、id は常に **`#` を含まず URL fragment
  として安全**であり、区切りの `:` とセグメント内部の値も衝突しない
  （`encodeURIComponent` は `:` を必ずエンコードするため）

### 対象ブロックの対応表

| 節 | ブロック単位 | 導出元（データ由来キー） | `kind` | id の例 |
|---|---|---|---|---|
| 1. 素材タイムライン帯 | 素材ごとの帯 | `assets[].ref` | `asset-timeline` | `asset-timeline:clip-01` |
| 1. レポート内画像（keyframes） | img 要素単位 | `ref` + キーフレームの `path`（画像が実在確認できた場合のみ。存在しないキーフレームは img 要素自体が描画されないため block-id も持たない） | `image` | `image:clip-01:keyframes%2Fkf-01.jpg` |
| 2. 文字起こし | 章単位 | `ref` + 章の開始秒（`events[type=chapter].t`）。analysis.schema に章専用の id フィールドが無いため「無ければ章開始時刻」側の安定キーとして開始秒を採用する。章情報が無い素材は `ref` + 固定サフィックス `unchaptered` の 1 ブロック | `transcript-chapter` | `transcript-chapter:clip-01:0` / `transcript-chapter:clip-01:unchaptered` |
| 3. 素材別 事実カード | 素材ごとのカード | `assets[].ref` | `asset-facts` | `asset-facts:clip-01` |
| 4. 素材間関係 | 関係行 | 起点 `ref` + `relation.target` + `relation.kind`（両端 ref + 関係種別） | `relation` | `relation:interview-a:broll-park:b_roll_of` |
| 5. 取材台帳 | 質問行 | `open_questions[].id` をそのまま使う | `question` | `question:oq-01` |
| 6. 来歴 | 節単位（契約が許容する固定キー） | 固定文字列 `section` | `provenance` | `provenance:section` |

- `asset-timeline` と `asset-facts` は同じ `ref` を使っても `kind` が違うため衝突しない
  （id はあくまで `<kind>:<segment...>` 全体で一意性を見る）
- `image` の id は `ref` を含める（`kind` に対して `path` 単独ではなく `ref:path` の
  複合キー）。異なる素材が同じ相対パス（例: `keyframes/kf-01.jpg`）のキーフレームを
  持つケースでも文書内一意を保つため
- `relation` の id は起点 `ref`・`target`・`kind` の 3 つを含む複合キー。同一起点素材に
  同一 `target`/`kind` の関係行が 2 件あれば意図的な衝突としてハードエラーになる
  （データの重複自体が本来おかしいため妥当な挙動）
- **最低限の対象ブロック 7 種のみ**（契約 §1 の表どおり）。節 4 の「浮いた素材
  （orphan / unclear）」や節 3 のイベントチップ単位などは今回のスコープ外
  （地ならしタスクの「最低限」に従う。将来注釈 UI の要件で必要になれば拡張する）

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
