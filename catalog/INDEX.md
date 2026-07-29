# AKARI Video 素材カタログ

このディレクトリは、`assets/` と同じ meta.json v0 契約を使う「取得先の索引」です。
バイナリそのものはホストせず、各エントリの meta.json に `source`（取得先 URL・取得方法・
ライセンス表記）と `remote: true` を持たせて、取得はユーザー自身の環境に委ねます。
詳細な契約は [`docs/contract-2026-07-13-asset-library.md`](../docs/contract-2026-07-13-asset-library.md)
の「カタログと取得スキル」§を参照してください。

## 入庫基準

`assets/` と同じく「生成コストが高い、または生成不能なものだけ」を入れます。加えて、
取得元の再配布ライセンスがバイナリ同梱を許さないもの（フォント等）は、この
カタログ（`remote: true`）側で扱います。

## カテゴリ

計 22 件収録（2026-07-29 時点）。

カテゴリは `assets/` と同じく**配布物の形**で切ります（2026-07-29 変更）。主題は tags です。

- [scene3d](./scene3d/INDEX.md) — 製品モックアップなど、再生成が難しい 3D モデル・HDRI の取得先。3 件収録。
- **overlay** — 映像に重ねる時間つき HTML 断片の取得先。整備中。
- [audio](./audio/INDEX.md) — BGM・効果音などの音源素材の取得先。15 件収録（2026-07-22・オーナー私物 SE パックの出典調査で 9 件追加）。
- [broll](./broll/INDEX.md) — 主映像を補足する実写映像素材の取得先。1 件収録。
- [font](./font/INDEX.md) — 特定の書体そのもの（グリフ）は生成不能なため、取得先の索引として扱う。3 件収録。
- [avatars](./avatars/INDEX.md) — 性格・話し口調を核に 2D/3D/実写/音声を rendition として持つキャラクター登録。`rights.subject` が `original` / `third_party` のもののみ入庫可（実在人物は個人スコープへ）。0 件収録（2026-07-26 時点）。**本カテゴリだけは meta.json v0 ではなく avatar registry v0（`packages/schemas/avatar.schema.json`）で検証する**別契約です（`docs/contract-2026-07-26-avatar-registry-v0.md`）。

## ここに無いもの（2026-07-29 移設）

テロップテンプレート（36 件）と LUT（2 件）は [presets/](../presets/INDEX.md) へ移しました。
どちらも実体を持ち、人が選んでコピーするのではなく**コードが id でファイルを引く参照表**であり、
「実体を持たない取得先の索引」というこのディレクトリの契約に合わなかったためです。

- テロップテンプレート → [presets/telop/](../presets/telop/INDEX.md)（`bake-layer --preset <id>`）
- LUT → [presets/luts/](../presets/luts/INDEX.md)（`edit.json` の `output.look.lut`）
