# presets/textstyle — プレーンテキストスタイル（v0・2026-08-03 新設）

「テキストをポンと置きたい」ための**軽量スタイルプリセット**。退役した ATF 描画とは独立しており、
レイヤー構造を持たず、見た目パラメータと任意の textanim 既定を持つ JSON。旧 AKARI Video
（akari-video-on-os `src/lib/text-templates.ts` の 141 件）からオーナー選別の 11 件を移植し、
標準字幕 1 件を加えた。

設計思想（2026-08-03 オーナー裁定）: **ベースは少数、あとはツマミで変える**。
全フィールド（フォント / 太さ / 色 / 字間 / 縁取り / 座布団 / 影 / グロー / 大文字化）が
そのままツマミであり、派生スタイルはユーザーがツマミで作る。

## 使い方

`style` オブジェクトは `captions.json` の `default_text_style` と同じ語彙系（snake_case）。
字幕への正式な適用方法は、各 `captions[]` レコードの `style_preset` にこの一覧の id を
保存する方法である。消費側は読み込み時に id を解決し、プリセットを低優先、同じレコードの
`text_style` を高優先として値へ展開する。`default_text_style` / `text_style` へ値を直接
焼き込む従来の CLI と手順も互換経路として残す。
`style.animation` があるプリセットは、`in` / `out` / `loop` の既定も同時に適用する。
字幕ごとの `text_style.animation` は同名スロットだけを上書きする。
**対応状況（2026-08-13 実測）**: 現行レンダラ（`packages/render-cut/src/captions.mjs`）は
このカタログが使うフィールドをすべて CSS 変数へ落として描画する。既存 11 件全部を 1080x1920 の
caption overlay として実描画し、算出スタイルと画素差で確認済み:
color / size_px / weight / font_family / letter_spacing_em / text_transform / stroke /
shadow / glow / background(color, opacity, padding_px, radius_px) / position / animation。
回帰テストは `packages/render-cut/test/captions-textstyle-v0.test.mjs`。

**既知の制限**: `shadow.color` / `glow.color` は 16 進表記（`#RRGGBB`）で書く。
`rgba(...)` の関数記法を書くと生成される CSS が無効値になり、影が丸ごと落ちる
（既定の薄影も残らない）。現状 verdict-badge の `shadow.color` がこれに該当する。

## 一覧（12 件）

| id | 名前 | 元カテゴリ | animation 既定 |
|---|---|---|---|
| subtitle-news | ニュース風 | subtitle | — |
| subtitle-standard | 標準字幕 | subtitle | — |
| subtitle-variety | バラエティ | subtitle | — |
| subtitle-commentary | 実況テロップ | subtitle | in: caption-rise |
| subtitle-interview | インタビュー字幕 | subtitle | — |
| narration-caption | ナレーション字幕 | subtitle | — |
| emphasis-red | 強調 | emphasis | in: pop |
| verdict-badge | 判定バッジ | emphasis | — |
| discount-text | 割引バッジテキスト | price | — |
| neon | ネオン | decorative | in/out: soft-fade, loop: neon-flicker |
| glitch | グリッチ風 | decorative | in: glitch |
| title-impact | インパクト | title | — |

- 移植元: akari-video-on-os `src/lib/text-templates.ts`（各 JSON の `source` に記録）
- 選別の経緯: 内部リポ planning/attachments/2026-08-03-textstyle-selection/（141 件からオーナー選別）
- 残り 130 件の再移植は同じ変換で可能（オーナー選別が増えたら追加する）
