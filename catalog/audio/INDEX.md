# Audio カタログ

`assets/audio/` と同じ入庫基準（利用許諾と来歴を明示できる、再収録コストの高い BGM・効果音）の取得先索引です。実体は同梱せず、各エントリの `source.url` から取得してください。BGM / SFX の区別は tags に持たせています。

## 既定ソース: AKARI Sounds（2026-08-03 オーナー裁定）

音源の既定は自社（first-party）ライブラリ **[AKARI Sounds](https://github.com/AkariLabs/akari-sounds)**（BGM 99 / 効果音 77 / ジングル 12 = 188 トラック・200 テイク。全トラック AI 生成・生成記録公開・商用可・クレジット不要）です。

- **BGM・ジングルは全量 AKARI Sounds**。外部フリー配布元の BGM 候補は廃止しました
- **効果音は AKARI Sounds が既定 + 外部で補完**。AKARI Sounds に無い系統（拍手・歓声 / 失敗音の日本のお約束 / 和風・バトル打撃 / フォーリー）だけ外部候補・既存エントリを使います
- 自社 GitHub Release が配布主体のため**一括ダウンロード可**。動線は `akari` 初回起動時の
  [Y/n] 1 問（既定 Yes・生涯 1 回）または `akari sounds`
  （実体: `node packages/audio-library-setup/bin/fetch-akari-sounds.mjs`。
  手順: [`skills/setup-audio-library/first-party.md`](../../skills/setup-audio-library/first-party.md)）
- **BGM の選曲は自動提案 CLI が起点**: `node packages/audio-library-setup/bin/suggest-bgm.mjs --tone <トーン>`
  （表現選定と同じ 8 語彙 × 系統対応表 × 体感 BPM の決定論ランキング。編集フローでの使い方:
  [`skills/edit-plan/report-guide.md`](../../skills/edit-plan/report-guide.md) §素材計画）
- **宣言（サビ・キメ・拍）は自分で付けられる**: `node packages/audio-library-setup/bin/declare-helper.mjs`
  → ブラウザのタイムライン画面で耳で付けて `<ライブラリ>/declarations.json` へ保存
  （スキル: [`skills/declare-audio/`](../../skills/declare-audio/SKILL.md)）。
  AKARI Sounds の曲は AKARI Store の宣言パック（耳検証済み・版ごと買い切り）でも入る
- **効果音・ジングルは「場面の意味」から**: `node packages/audio-library-setup/bin/suggest-sfx.mjs --meaning <意味>`
  （14 語の意味語彙 → 宣言表。AKARI Sounds に無い意味は本カタログの外部補完エントリへ誘導。
  対応表の耳レビューは `bin/review-sfx-mapping.mjs`）

## 音源セットアップ（補完分・半自動ドロップフォルダ方式）

[`candidates.json`](./candidates.json)（**v2**）は、AKARI Sounds を `first_party`（既定ソース）として宣言し、外部候補は補完 3 カテゴリ・13 カード（拍手 / 失敗音 / ヒット・ドンの和風・バトル系）だけを保持するデータ SSOT です。`node packages/audio-library-setup/bin/generate-candidates-html.mjs` で候補リスト HTML（既定ソースバナー + ダウンロードページを開くボタン付き・既所有は動的グレーアウト）を生成できます。手順は [`skills/setup-audio-library/`](../../skills/setup-audio-library/SKILL.md) を参照してください。

**レガシー**: v1 の全 68 カード（外部 BGM 27 カード・約 110 曲の選曲データ、mood/tempo 語彙、検証パス履歴を含む）は [`candidates-legacy.json`](./candidates-legacy.json) に原文のまま保存しています（不変・参照用。セットアップフローからは使いません）。

## エントリ

### 既定（AKARI Sounds・first-party）

- [akari-sounds-bgm](./akari-sounds-bgm/meta.json) — BGM パック（99 トラック / 110 テイク）。解説・Vlog・作業風景の敷きから tension / cinematic / beatslide まで。（license: LicenseRef-AKARI-Sounds-Terms-v0 / acquisition: direct・一括取得可）
- [akari-sounds-sfx](./akari-sounds-sfx/meta.json) — 効果音パック（77 トラック / 78 テイク）。クリック・ポップ・whoosh・チャイム・ライザー・グリッチ等のワンショット。（license: LicenseRef-AKARI-Sounds-Terms-v0 / acquisition: direct・一括取得可）
- [akari-sounds-jingle](./akari-sounds-jingle/meta.json) — ジングルパック（12 トラック）。イントロ / アウトロ / 場面転換 / 達成のスティンガー。（license: LicenseRef-AKARI-Sounds-Terms-v0 / acquisition: direct・一括取得可）

### SFX 補完（AKARI Sounds に無い系統・現役）

- [impact-sfx-pack](./impact-sfx-pack/meta.json) — 衝突・打撃・フォーリー系の効果音 130 点セット。強調テロップの出現・アクセントに。（license: CC0-1.0 / acquisition: direct）
- [soundeffect-lab-ui-signal-pack](./soundeffect-lab-ui-signal-pack/meta.json) — 決定ボタン・クイズ判定・警告・チーン系の UI/合図 SE 19 点セット（効果音ラボ）。（license: LicenseRef-SoundEffectLab-Free / acquisition: direct・要直リンク回避）
- [soundeffect-lab-anime-direction-pack](./soundeffect-lab-anime-direction-pack/meta.json) — シーン切り替え・強調カット・コミカルリアクション・キラキラ演出 SE 17 点セット（効果音ラボ）。（license: LicenseRef-SoundEffectLab-Free / acquisition: direct・要直リンク回避）
- [soundeffect-lab-ambient-life-pack](./soundeffect-lab-ambient-life-pack/meta.json) — 和楽器（和太鼓・拍子木・木魚）・観客リアクション・生活/環境音 SE 13 点セット（効果音ラボ）。（license: LicenseRef-SoundEffectLab-Free / acquisition: direct・要直リンク回避）
- [musmus-onomatope-sfx-pack](./musmus-onomatope-sfx-pack/meta.json) — ポップ/クリック系の電子オノマトペ音・Yes/No判定・チャイム 16 点セット（MusMus）。要クレジット。（license: LicenseRef-MusMus-Free / acquisition: direct）
- [dova-syndrome-hatena-mark-se](./dova-syndrome-hatena-mark-se/meta.json) — キャラクターの疑問・困惑を表す「はてなマーク」ポップアップ音（DOVA-SYNDROME）。（license: LicenseRef-DOVA-SYNDROME-Free / acquisition: direct）
- [freesound-inspectorj-pencil-writing](./freesound-inspectorj-pencil-writing/meta.json) — 鉛筆で紙に書くリアルな筆記音（尺12.7秒、InspectorJ）。要クレジット。（license: CC-BY-4.0 / acquisition: login）
- [maoudamashii-object-sound-15](./maoudamashii-object-sound-15/meta.json) — 汎用的な物音効果音「物音15」（魔王魂）。要クレジット。（license: LicenseRef-MaouDamashii-Free / acquisition: direct）
- [maoudamashii-se-magic-category](./maoudamashii-se-magic-category/meta.json) — マジカル27。IT/ガジェットのロゴ・ノイズ演出音 1 点（魔王魂）。要クレジット。（license: LicenseRef-MaouDamashii-Free / acquisition: direct）
- [maoudamashii-se-onepoint-category](./maoudamashii-se-onepoint-category/meta.json) — 不吉な不協和音・ふざけた失敗音・ダメ出しブッブーの 3 点（魔王魂）。要クレジット。（license: LicenseRef-MaouDamashii-Free / acquisition: direct）
- [maoudamashii-se-system-category](./maoudamashii-se-system-category/meta.json) — コイン系上昇音・解説ポイント提示音の 3 点（魔王魂）。要クレジット。（license: LicenseRef-MaouDamashii-Free / acquisition: direct）
- [pocket-se-fail-pack](./pocket-se-fail-pack/meta.json) — 呆れ「チーン」・ゲーム死亡音・失敗「デデーン」。やらかし演出の定番 SE 3 点（ポケットサウンド）。要クレジット。（license: LicenseRef-PocketSound-Free / acquisition: direct）

### レガシー（AKARI Sounds への一本化で役目を終えた既登録分）

2026-08-03 オーナー裁定により新規の編集では使いません（既存プロジェクトの参照と来歴のためにエントリは残置。ディレクトリ・meta.json は不変）。BGM は全量 AKARI Sounds へ、以下の SFX は AKARI Sounds の同系統（`sfx-click-camera-shutter` / `sfx-whoosh-*` / `sfx-click-*` / `sfx-pop-*`・`sfx-shimmer-sparkle` 等）で置き換え。

- BGM（8 件）: [corporate-upbeat-bgm](./corporate-upbeat-bgm/meta.json) / [cozy-lofi-bgm](./cozy-lofi-bgm/meta.json) / [dova-syndrome-cheerleaders-bgm](./dova-syndrome-cheerleaders-bgm/meta.json) / [dova-syndrome-user-manual](./dova-syndrome-user-manual/meta.json) / [maoudamashii-bgm-neorock](./maoudamashii-bgm-neorock/meta.json) / [maoudamashii-bgm-piano](./maoudamashii-bgm-piano/meta.json) / [musmus-hageshii-atsui-upper](./musmus-hageshii-atsui-upper/meta.json) / [musmus-yuttari-honobono](./musmus-yuttari-honobono/meta.json)
- SFX（4 件）: [camera-shutter](./camera-shutter/meta.json)（→ sfx-click-camera-shutter） / [whoosh-transition](./whoosh-transition/meta.json)（→ sfx-whoosh-* / sfx-swoosh-*） / [ui-click-sfx-pack](./ui-click-sfx-pack/meta.json)（→ sfx-click-* 15 種） / [otologic-motion-pop-sfx-pack](./otologic-motion-pop-sfx-pack/meta.json)（→ sfx-pop-* / sfx-shimmer-sparkle）
