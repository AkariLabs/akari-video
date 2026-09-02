# contract — 図形アイテム v0（edit.json v2 `shape` ソースとインライン SVG 降下）

- 状態: 実装済み（データ契約 + edit-store 降下。パネル露出・インスペクター UI は後続）
- 決定日: 2026-09-02
- 実装: `packages/schemas/edit.schema.json`（`itemSourceShapeV2` / `itemV2Shape`）/
  `packages/edit-store`（`src/shape-markup.ts`・`internal-model.ts`）

## 1. 目的

四角・線・矢印・吹き出しといった図形を、素材ファイル無しで edit.json v2 の第一級アイテムとして
宣言できるようにする。レンダラは新設しない — edit-store の内部モデルが図形を**決定論的な
インライン SVG を持つ html オーバーレイへ降下**させ、既存の html 経路（プレビュー・書き出しとも）が
そのまま描く。

## 2. 語彙 v0

```json
{ "id": "shape-1", "at": 0, "duration": 90,
  "source": { "kind": "shape", "shape": "rect",
              "params": { "width": 600, "height": 340, "fill": "#f97316" } } }
```

- `shape`: `rect | rounded-rect | ellipse | line | arrow | speech-bubble`
- `params`（全部 optional・additionalProperties false で開始 — 広げる方向は互換）:
  `width`（>0・既定 600）/ `height`（>0・既定 340。line / arrow は既定 80）/
  `fill`（既定 `#f97316`）/ `stroke`（既定なし = 描かない）/ `strokeWidth`（≥0・既定 0。line / arrow は 8）/
  `cornerRadius`（≥0・rounded-rect のみ・既定 24）
- 色文字列は `^[#a-zA-Z0-9(),.%\s-]{1,64}$` に一致しないとき既定色へフォールバック
  （SVG への注入封じ）。数値は有限数のみ受理・範囲外は既定へ。
- 位置・拡大・不透明度・アニメはアイテム共通機構（`anchor` / `transform` / `opacity` /
  `keyframes` / `motion` / `animator`）に委ね、params に重複ツマミを作らない。

## 3. 降下の契約

- `shapeMarkup(source)`（`packages/edit-store/src/shape-markup.ts`）は同一入力に対して
  バイト同一の `<svg …>` 文字列を返す（時刻・乱数・環境非依存）。
- 内部モデルは shape アイテムを html アイテムと同格に扱い、オーバーレイ宣言の `html` に
  インラインマークアップを乗せる（`<` 始まりのため render-cut の `expandedHtmlOverlays` は
  ファイル読込をせずそのまま通す）。
- 既知の制約: SVG の xmlns URI が GPU 出口の適格性検査に absolute-external-url として
  検知されるため、図形入りの書き出しは現状 **OSR 出口へフォールバック**する（描画は正しい）。
  GPU 適格化（名前空間 URI の許可リスト化）は後続。

## 4. スコープ外（後続）

- 素材パネルの図形カテゴリ露出（現状は「近日」）・インスペクターの params ツマミ
- スタンプ（新種別にしない — 画像素材で賄う）

出自: 2026-09-02 の素材パネル再設計ラウンド（カテゴリ表「図形は種別追加から」）。
