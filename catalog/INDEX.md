# AKARI Video 素材カタログ

アプリの画面では、ここに載るものは**素材**（音・3D・映像・フォントなど）の取得先です。
スタイル（字幕スタイル・LUT・つなぎ・動き）は素材とは別の棚で、コードが id で引く参照表として
[presets/](../presets/INDEX.md) にあります。まとまった「テンプレート」や「作り方」もここには入りません。

このディレクトリは、`assets/` と同じ meta.json v0 契約を使う「取得先の索引」です。
バイナリそのものはホストせず、各エントリの meta.json に `source`（取得先 URL・取得方法・
ライセンス表記）と `remote: true` を持たせて、取得はユーザー自身の環境に委ねます。
詳細な契約は [`docs/contract-2026-07-13-asset-library.md`](../docs/contract-2026-07-13-asset-library.md)
の「カタログと取得スキル」§を参照してください。

利用者のプロジェクトには、この `catalog/` フォルダはありません。
エージェントや CLI からは `akari assets catalog` で場所を、`akari assets list --source site` で外部項目の一覧を確認します。
1 件の取得先は `akari assets show <category/id>`、取り込んだ素材の検証は `akari assets validate <dir>` を使います。

## 入庫基準

`assets/` と同じく「生成コストが高い、または生成不能なものだけ」を入れます。加えて、
取得元の再配布ライセンスがバイナリ同梱を許さないもの（フォント等）は、この
カタログ（`remote: true`）側で扱います。

## カテゴリ

計 64 件収録。

カテゴリは `assets/` と同じく**配布物の形**で切ります（2026-07-29 変更）。主題は tags です。

- [scene3d](./scene3d/INDEX.md) — 製品モックアップなど、再生成が難しい 3D モデル・HDRI の取得先。3 件収録。
- **overlay**（画面の語は「動く部品」）— 映像に重ねる時間つき HTML 断片の取得先。整備中。0 件収録。
- [audio](./audio/INDEX.md) — BGM・ジングルは AKARI Sounds が既定。効果音は外部の無料の参照ライブラリが中心。定番は `pack:audio-standard` タグで示し、パック台帳は [packs.json](./packs.json) を参照。29 件収録。
- [broll](./broll/INDEX.md) — 主映像を補足する実写映像素材の取得先。1 件収録。
- [font](./font/INDEX.md) — 特定の書体そのもの（グリフ）は生成不能なため、取得先の索引として扱う。31 件収録。
- [avatars](./avatars/INDEX.md) — 性格・話し口調を核に 2D/3D/実写/音声を rendition として持つキャラクター登録。`rights.subject` が `original` / `third_party` のもののみ入庫可（実在人物は個人スコープへ）。**本カテゴリだけは meta.json v0 ではなく avatar registry v0（`packages/schemas/avatar.schema.json`）で検証する**別契約です（`docs/contract-2026-07-26-avatar-registry-v0.md`）。0 件収録。

## カテゴリのほかに置いているもの

- [packs.json](./packs.json) — 定番のまとまり（`pack:` タグ）の台帳。フォントの定番パックと音の定番パックがある。
- [sites/](./sites/) — 外部の配布サイトごとの取得先（9 サイト）。各エントリの `source` が指す。
- [browser/browser-engines.json](./browser/browser-engines.json) — アプリ内ブラウザの画像検索エンジンの一覧。ダウンロードは受け付けない設定。

## ここに無いもの（2026-07-29 移設）

テロップテンプレート（36 件）と LUT（2 件）は [presets/](../presets/INDEX.md) へ移しました。
どちらも実体を持ち、人が選んでコピーするのではなく**コードが id でファイルを引く参照表**であり、
「実体を持たない取得先の索引」というこのディレクトリの契約に合わなかったためです。

- 字幕スタイル（旧テロップ）→ [presets/textstyle/](../presets/textstyle/INDEX.md)。テロップテンプレートの ATF 描画は退役し、HTML 素材版（動く部品）は Lab で取得します。
- LUT → [presets/luts/](../presets/luts/INDEX.md)（10 種。`edit.json` の `output.look.lut`）
