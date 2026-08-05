# presets/textstyle — プレーンテキストスタイル（v0・2026-08-03 新設）

「テキストをポンと置きたい」ための**軽量スタイルプリセット**。ATF（presets/telop）と違い
アニメーション・レイヤー構造を持たない、見た目パラメータだけの JSON。旧 AKARI Video
（akari-video-on-os `src/lib/text-templates.ts` の 141 件）からオーナー選別の 11 件を移植した。

設計思想（2026-08-03 オーナー裁定）: **ベースは少数、あとはツマミで変える**。
全フィールド（フォント / 太さ / 色 / 字間 / 縁取り / 座布団 / 影 / グロー / 大文字化）が
そのままツマミであり、派生スタイルはユーザーがツマミで作る。

## 使い方

`style` オブジェクトは `captions.json` の `default_text_style` と同じ語彙系（snake_case）。
字幕に適用するにはそのまま `default_text_style` にマージする。
**注意**: 現行レンダラ（packages/render-cut/src/captions.mjs）が解釈するのは
color / size_px / stroke / background(color, opacity) まで。weight / letter_spacing_em /
shadow / glow / text_transform / font_family / background(padding_px, radius_px) は
スキーマとして先行定義しており、レンダラ側の対応は内部契約
（内部リポ akari-video-internal の textstyle-v0 契約）の残作業。

## 一覧（11 件）

| id | 名前 | 元カテゴリ |
|---|---|---|
| subtitle-news | ニュース風 | subtitle |
| subtitle-variety | バラエティ | subtitle |
| subtitle-commentary | 実況テロップ | subtitle |
| subtitle-interview | インタビュー字幕 | subtitle |
| narration-caption | ナレーション字幕 | subtitle |
| emphasis-red | 強調 | emphasis |
| verdict-badge | 判定バッジ | emphasis |
| discount-text | 割引バッジテキスト | price |
| neon | ネオン | decorative |
| glitch | グリッチ風 | decorative |
| title-impact | インパクト | title |

- 移植元: akari-video-on-os `src/lib/text-templates.ts`（各 JSON の `source` に記録）
- 選別の経緯: 内部リポ planning/attachments/2026-08-03-textstyle-selection/（141 件からオーナー選別）
- 残り 130 件の再移植は同じ変換で可能（オーナー選別が増えたら追加する）
