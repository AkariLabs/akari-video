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

#### リッチ字幕テロップ（21 種・2026-08-06 同梱）

放送級・柄フィル・質感・ポップ柄・ネガ系・怒り・ゴージャスの 7 系統。いずれも `data-mirror="text"` の層ミラー規約（`min_overlay_runtime_version: "0.2.0"`）で編集同期する多層積み断片。

- **放送級**
  - [telop-broadcast-gold-navy](./telop-broadcast-gold-navy/meta.json) — 金/紺 6 層の多重縁取りで仕立てた放送番組級の見出しテロップ。「◯年の歴史に幕」のような節目・周年告知に。
- **柄フィル**（`background-clip: text` にタイル柄を流し込む系統）
  - [telop-pattern-diamond](./telop-pattern-diamond/meta.json) — 紫グラデにひし形アイコンと斜め光の筋を重ねたダイヤ柄。ゴージャス・限定感の一撃装飾。
  - [telop-pattern-dot](./telop-pattern-dot/meta.json) — 青グラデに大小2種の水玉を重ねたドット柄。
  - [telop-pattern-night](./telop-pattern-night/meta.json) — 紺の縦グラデに星とサンバーストを散らした夜空柄。
  - [telop-pattern-stripe](./telop-pattern-stripe/meta.json) — ピンク×白の横縞に光沢オーバーレイを重ねたストライプ柄。
  - [telop-pattern-gingham](./telop-pattern-gingham/meta.json) — 緑の縦グラデに白グリッド線を重ねたギンガムチェック柄。
  - [telop-pattern-skull](./telop-pattern-skull/meta.json) — ドクロ SVG アイコンを敷き詰めた黒系縦グラデのゴシック柄。
  - [telop-pattern-hazard](./telop-pattern-hazard/meta.json) — 警告三角アイコンを敷き詰めた金の3段グラデ・明朝柄。
- **質感**
  - [telop-texture-concrete](./telop-texture-concrete/meta.json) — feTurbulence 由来のコンクリ粒子質感 + 強い赤グロー。
  - [telop-grunge-bullet](./telop-grunge-bullet/meta.json) — 赤系横グラデの極太明朝に弾痕状の欠けを施したグランジ質感。
  - [telop-slash-red](./telop-slash-red/meta.json) — 赤系グラデの極太明朝を斬撃状マスクで切り抜いた質感。
- **ポップ柄**（明背景向け・角丸ゴシック + 太縁 + ずらし影）
  - [telop-pop-dot](./telop-pop-dot/meta.json) — 青系グラデに水玉柄のポップテロップ。
  - [telop-pop-heart](./telop-pop-heart/meta.json) — 紫系グラデにハート柄のポップテロップ。
  - [telop-pop-thunder](./telop-pop-thunder/meta.json) — 黄色縞地に稲妻アイコンを散らしたポップテロップ。
- **ネガ系**（沈み込むダークグラデ + 繊細なハロー）
  - [telop-nega-abyss](./telop-nega-abyss/meta.json) — 薄紫から漆黒へ沈む縦グラデの明朝体 + 白ヘアライン + 弱いグロー。
  - [telop-nega-brush](./telop-nega-brush/meta.json) — 手書き風フォントの紫→黒グラデ + 白ヘアライン + 紫グローの太いハロー。
- **怒り**（赤→黒グラデ + 縁取り + 雲状グローの抗議・強調系。共通配色を3書体で展開）
  - [telop-anger-mincho](./telop-anger-mincho/meta.json) — 白縁 + 黒い雲グローの極太明朝版。
  - [telop-anger-gothic](./telop-anger-gothic/meta.json) — 同配色・同層構成の極太ゴシック版。
  - [telop-anger-gold](./telop-anger-gold/meta.json) — 黄縁 + 黒ずらし影 + 黄色い雲グローのコミック調版。
- **ゴージャス**
  - [telop-gold-3d](./telop-gold-3d/meta.json) — 金属グラデ本体 + 黒太縁 + 金ヘアライン + 二段押し出し3D演出の極太ゴシック。
- **強調**
  - [telop-kuro-aka](./telop-kuro-aka/meta.json) — 黒に沈む明朝体 + 赤い細縁 + 赤いにじみグローのシンプルな強調テロップ。

## このカテゴリに入るもの

映像に重ねる時間つきの HTML 表現で、生成コストが高いもの。デザイン完成度の高いテロップ構図、
枠と中身のスロットを持つ構図（黒板・ホワイトボード・ブラウザモック・2D デバイスモック）、
多要素で組まれた決定的モーション。

## このカテゴリに入らないもの

自然言語から毎回すぐ再生成できる単純な字幕スタイルや素朴な fade / slide。時間を持たない
静止シート（→ [still](../still/INDEX.md)）。Three.js + glTF を要するもの（→ [scene3d](../scene3d/INDEX.md)）。
