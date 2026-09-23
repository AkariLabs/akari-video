# マイスタイル v0 — 部品の束と見た目の保存

- 日付: 2026-09-24
- 状態: v0

## 1. スタイルと置き場

スタイルは「どの場面で使うか」と、その場面で当てる部品の束である。テンプレートは動画単位の構成であり、スタイルとは別に扱う。同梱の `presets/textstyle` はコードが `style_preset` の id で引く参照表であり、マイスタイルはユーザーが保存した値である。ライブラリのテキストスタイル一覧では両方を並べて見せる。

保存先は `resolveAssetLibraryRoots().write` が返すライブラリの書き込み root の下の `styles/<id>/style.json`。`thumbnail.png` を同じフォルダに置いてもよい。root の解決順は既存の `AKARI_LIBRARY_ROOT` → `$AKARI_HOME/library-location.json` の `root` → `$AKARI_HOME/assets` を使う。新しい置き場規則は設けない。

## 2. 保存形

```json
{
  "schema": "akari-style/v0",
  "id": "my-variety-emphasis",
  "name": "バラエティ強調",
  "when_to_use": "驚きを短く強調するとき",
  "parts": [
    { "kind": "look", "text_style": { "color": "#ff1744", "stroke": { "color": "#ffffff", "width_px": 6 } } }
  ],
  "sample_text": "これは最高のアイデアです",
  "created_at": "2026-09-24T00:00:00.000Z",
  "updated_at": "2026-09-24T00:00:00.000Z",
  "license": "private",
  "version": 1
}
```

`author` は任意。`license` の既定値は `private`。`parts` は `kind` で拡張する開いた配列で、予約済みの種類は `look`、`motion`（`animation {in,loop,out}`）、`sfx`、`fx`、`decor`、`camera`。v0 が保存・適用するのは `look` だけである。未対応の部品は読み書きで保持し、適用時は無視して 1 行通知する。

スタイルは自己完結した JSON とする。ローカルの絶対パスを入れず、他の素材を指す必要がある部品は素材参照モデルの id または URL を使う。この条件を満たした保存形はそのまま Lab やコミュニティへ出せる。公開するかどうかはユーザーが決める。

## 3. 保存と適用

字幕または置いた文字から保存する `look.text_style` は、`default_text_style` → `style_preset` → cue の `text_style` を既存規則でマージした実効値である。`position`、`text_anchor`、`zone` は保存しない。動きは別部品のため `look` の `animation` に含めない。

当てる際は `look.text_style` の値を対象字幕の `text_style` にフィールド単位で写す。`stroke`、`background`、`shadow`、`glow` などの入れ子は、既存の字幕スタイル書き込み経路と同じ粒度でマージする。入っていない部品・フィールドと位置は上書きしない。複数字幕への適用は 1 回の操作として undo できる。保存元のライブラリへの参照は captions.json に残さないため、別のマシンでの書き出しもライブラリに依存しない。captions.json のスキーマは変更しない。
