# Overlay 素材 — 時間を持つ HTML 断片

映像の上に重ねる HTML 断片です。`data-start` / `data-duration` を持ち、`edit.json` の
`overlays[]` から時間つきで合成されます（authoring 規約:
[skills/overlay-authoring](../../skills/overlay-authoring/SKILL.md)）。

**主題はカテゴリではなく tags で引きます。** テロップ・黒板・ブラウザモック・図解・複雑モーションは
すべてここに入り、`lower-third` / `board` / `frame` / `motion` などの tags で絞り込みます
（2026-07-29 に主題別カテゴリ `telop` / `motion` をここへ統合）。

## 素材

### テロップ・情報提示

- [lower-third-clean](./lower-third-clean/meta.json) — 名前と肩書を端正な 2 行で見せる、インタビュー・人物紹介向けロワーサード。

## このカテゴリに入るもの

映像に重ねる時間つきの HTML 表現で、生成コストが高いもの。デザイン完成度の高いテロップ構図、
枠と中身のスロットを持つ構図（黒板・ホワイトボード・ブラウザモック・2D デバイスモック）、
多要素で組まれた決定的モーション。

## このカテゴリに入らないもの

自然言語から毎回すぐ再生成できる単純な字幕スタイルや素朴な fade / slide。時間を持たない
静止シート（→ [still](../still/INDEX.md)）。Three.js + glTF を要するもの（→ [scene3d](../scene3d/INDEX.md)）。
