# マイスタイル v0 — 保存形と適用契約

- 日付: 2026-09-24
- 状態: v0

## 1. 役割と置き場

スタイルは使いどころと部品の束であり、動画単位のテンプレートとは別物。同梱の `presets/textstyle` はコードが `style_preset` で引く参照表で、マイスタイルはユーザーが保存した値である。テキストスタイルの棚では両方を並べて見せる。
素材の `{category,id}` と `.akari/asset-references.json` は `contract-2026-09-02-asset-reference-model.md` に従う。マイスタイルの `styles/` は `contract-2026-07-13-asset-library.md` の高コスト素材の入庫基準の対象外である。

ユーザー共通の保存先は `resolveAssetLibraryRoots().write` の下の `styles/<id>/style.json`。root は既存の `AKARI_LIBRARY_ROOT` → `$AKARI_HOME/library-location.json` → `$AKARI_HOME/assets` の順で解決する。プロジェクト専用の予約先は `<project>/.akari/styles/<id>/style.json`。v0 の UI はユーザー共通だけを扱う。

保存は一時ファイルを書いて同一ディレクトリ内で rename する。既存 `id` が別 `uid` なら上書きを拒み、別 `id` に同じ `uid` があっても拒む。既存 `id` と `uid` が一致する更新は `revision` が後退しない場合だけ許す。名前変更は `name` と `revision` を更新し、`uid` と `id` は保つ。別の slug に改名する将来の UI でも `uid` は保つ。読めない保存形は一覧から除外し、ほかのカードを表示する。

## 2. 保存形

```json
{
  "schema": "akari-style",
  "version": 1,
  "revision": 1,
  "uid": "01K5ZXY123ABCDEFGHJKMNPQRS",
  "id": "my-variety-emphasis",
  "name": "バラエティ強調",
  "when_to_use": "驚きを短く強調するとき",
  "tags": [],
  "parts": [
    { "kind": "look", "scope": "caption", "mode": "modify",
      "text_style": { "color": "#ff1744", "size_px": 80, "reference_height_px": 1920,
        "stroke": { "width_px": 0 }, "background": { "opacity": 0 },
        "shadow": { "color": "#000000", "opacity": 0 },
        "glow": { "color": "#000000", "density": 0 } } }
  ],
  "sample_text": "これは最高のアイデアです",
  "created_at": "2026-09-24T00:00:00.000Z",
  "updated_at": "2026-09-24T00:00:00.000Z",
  "license": { "spdx": "LicenseRef-user-owned", "scope": "private-owned",
    "attribution_required": false, "ai_training_allowed": false },
  "visibility": "private",
  "price": null,
  "requires": [],
  "provenance": {}
}
```

`schema` は版を含まない識別子。保存形の版は整数 `version` のみで、v0 は `1`。`revision` はそのスタイルの改訂番号で `1` から始まる。`uid` は作成時の ULID で不変、`id` は人が読める slug。`author` は任意。`parts` は未知の `kind` も往復保持する開いた配列。予約語は `look`、`motion`（`animation {in,loop,out}`）、`sfx`、`fx`、`decor`、`camera`。v0 が保存・適用するのは `look` だけであり、未知の部品は適用せず 1 行通知する。

部品の共通欄は `scope: "caption" | "run" | "clip" | "scene"`、`mode: "attach" | "modify"`、任意の `attach: { at: "in" | "out" | "whole", offset_frames: number }`。`attach` は sfx / fx / decor の相対時刻で edit.json v2 の anchor に写せる形。`mode: "attach"` は別要素をひも付け、`modify` は既存要素を変更する。camera の `modify` は字幕の下のクリップを対象とする。v0 の look は `scope: "caption"`、`mode: "modify"`。`applies_to` は保存せず、`parts[].scope` の重複を除いた集合から導出する。

依存する素材の参照は `{ "category": "…", "id": "…" }` とし、`requires[]` はフォント・素材の id と版を記録できる予約欄。スタイル全体にローカル絶対パスを含めない。`provenance` にもパスを含めない。`tags[]` はシチュエーション検索用。`license` は素材 meta.json と同じ SPDX 等のオブジェクトで、既定は私有。公開可否は別欄の `visibility: "private" | "shared"`（既定 private）で表す。`price: null` は予約値。署名は v0 で不要。

任意の `thumbnail.png` は固定の `sample_text` と同じ描画条件から決定論的に生成する。無い場合は棚で `sample_text` を使うフォールバック表示にする。公開前には自己完結性、ライセンス、依存素材の利用条件を確認する。

## 3. look の保存と解像度

字幕または置いた文字の `default_text_style` → `style_preset` → cue の `text_style` を既存規則で解決した実効値を保存する。`look.text_style` の許可フィールドは `color`、`size_px`、`reference_height_px`、`font_family`、`font_weight`、`weight`、`line_height`、`letter_spacing_em`、`stroke`（`color`, `width_px`）、`background`（`color`, `opacity`, `radius_px`, `padding_px`, `mode`）、`shadow`（`color`, `opacity`, `blur_px`, `distance_px`, `angle_deg`）、`glow`（`color`, `density`, `spread`, `offset_x`, `offset_y`）だけ。保存時も読み込み時もこの許可リストで絞る。`animation`、`layout`、`position`、`text_anchor`、`zone` は look に含めない。
実効値に stroke / background / shadow / glow が無いか無効なときも、省略せず無効値を保存する。既定値がある当て先でも「無し」を再現するため、順に `{width_px:0}`、`{opacity:0}`、`{color:"#000000",opacity:0}`、`{color:"#000000",density:0}` を使う。

保存時に `reference_height_px` を保存元の edit.json の `output.height` で必ず埋める。適用先へ値をそのまま写す。描画時は `packages/edit-store/src/caption-display.ts` の `resolveCaptionReferenceScale` が `output.height / reference_height_px` を px 系の値に掛ける。たとえば 1920px 高の案件で作った 80px の文字は 1080px 高で 45px になる。`layout` と `reference_height_px` は既存の描画契約で排他なので、全対象の置換後の実効値（`default_text_style` + cue、`style_preset` は除去済み）を事前に調べる。1 件でも衝突すれば全件を書かず、理由を通知する。＋/ドラッグで置く文字にも同じ確認を行う。

## 4. 適用、undo、利用履歴

look の適用は部品単位の置換。許可フィールドの集合について当て先の値を look の値で置き換え、look に無いフィールドは当て先から削除する。`stroke` などの入れ子も部品全体を置換する。許可リスト外の位置・animation・layout・その他の値は保持する。同じ字幕ファイルへの書き込みで `style_preset` を外す。適用・undo・redo は `writeEditSnapshot` の `captionsSource` 経路でガード付き検証と書き込み通知を通す。複数選択を含め、見た目と `style_preset` は undo 1 回でともに元へ戻る。ドラッグ / ＋ の置いた文字にも同じ置換規則を使う。

当てるたびに `<project>/.akari/style-usage.json` の `entries[]` に `{caption_ids: string[], style_uid, revision, parts: string[], applied_at}` を追記する。`parts` は実際に当てた kind の一覧。置いた文字にも追記する。この台帳は追記のみで undo では巻き戻さない。captions.json にスタイル参照を残さず、値をコピーするため別マシンでの書き出しもライブラリに依存しない。将来「元を直したら反映」は台帳を使った明示の再適用で行い、自動上書きしない。

## 5. 文字範囲への引き継ぎ

スタイルは文字の位置や「何文字目」を持たない。「強調した語は赤・大きく」は `look` に `scope: "run"` と `role: "emphasis"` を付けた規則として表す。captions.json の runs に `role` を持たせる変更は文字範囲の次の契約で定める。
