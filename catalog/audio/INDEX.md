# Audio カタログ

`assets/audio/` と同じ入庫基準（利用許諾と来歴を明示できる、再収録コストの高い BGM・効果音）の取得先索引です。実体は同梱せず、`source.url` から各自取得してください。BGM / SFX の区別は tags に持たせています。

## 音源セットアップ（半自動ドロップフォルダ方式）

[`candidates.json`](./candidates.json) は、フリー配布元 68 候補カード（8 用途 SFX カテゴリ 41 件 +
BGM 27 件・収録曲換算 約110曲）のデータ SSOT です。`node packages/audio-library-setup/bin/generate-candidates-html.mjs`
で候補リスト HTML（ダウンロードページを開くボタン付き・既所有は動的グレーアウト）を
生成できます。手順は [`skills/setup-audio-library/`](../../skills/setup-audio-library/SKILL.md)
を参照してください。

BGM は「落ち着き系」（`bgm-calm`、11カード・約63曲、作業・解説・vlog 向けの定番）／
「盛り上げ系」（`bgm-uplift`、6カード・約33曲、OP・見せ場・テンション上げ）／
「補完」（`bgm-other`、10カード・約14曲、エモ・シネマ・コミカル・参照系）の3カテゴリに
分割し、構成比は目安どおり概ね 6:3:1（実測 57%/30%/13%）です。各候補（カード）は
`mood[]`（真面目・親しみ・高級感・勢い・かわいい・無機質・エモい・シネマ — intake の
tone チップと同一語彙）+ `tempo`（ゆったり/標準/高速）タグを持ち、複数曲を束ねるカードは
`songs[]` に曲ごとの mood/tempo を個別記録します（全8トーンで最低2件を大きく上回るカバレッジ）。
将来「分析 → tone 決定 → mood 一致で BGM 自動選曲」のパイプラインを見据えたデータ設計で、
選曲ロジック自体は未実装です。DOVA-SYNDROME・MusMus・魔王魂・甘茶の音楽工房を中心に、
「よく使われている」定番曲（DLランキング上位・各サイトの主要カテゴリ）を優先収録
（MusMus・魔王魂はクレジット表記必須・書式は各候補の `credit_template` を参照）。
songs[] の個別曲は一覧ページのタイトル表示から採用しており、実ファイル名が未確認のため
`expected_filenames` は空のまま（ドロップフォルダの自動照合はサイト単位の一部候補にのみ効く）。

## エントリ

### BGM

- [corporate-upbeat-bgm](./corporate-upbeat-bgm/meta.json) — ミニマルなビート主体の明るいコーポレート BGM（尺 2分05秒）。SaaS/製品デモ向け。（license: LicenseRef-Pixabay-Content-License / acquisition: direct）
- [cozy-lofi-bgm](./cozy-lofi-bgm/meta.json) — Pixabay Editor's Choice のローファイ・チルビート（尺 2分27秒）。Vlog・作業風景向け。（license: LicenseRef-Pixabay-Content-License / acquisition: direct）

### SFX

- [camera-shutter](./camera-shutter/meta.json) — 一眼レフ実機（Canon T2i）のシャッター音（尺 0.3秒）。カット送り・決定的瞬間の演出に。（license: CC0-1.0 / acquisition: login）
- [impact-sfx-pack](./impact-sfx-pack/meta.json) — 衝突・打撃・フォーリー系の効果音 130 点セット。強調テロップの出現・アクセントに。（license: CC0-1.0 / acquisition: direct）
- [ui-click-sfx-pack](./ui-click-sfx-pack/meta.json) — ボタン・スイッチ・クリックなど UI 操作音 50 点セット。UI 解説・アプリデモ向け。（license: CC0-1.0 / acquisition: direct）
- [whoosh-transition](./whoosh-transition/meta.json) — 竹の棒を振って収録した短く鋭いウッシュ音（尺 0.43秒）。シーン転換・ワイプに。（license: CC0-1.0 / acquisition: login）
