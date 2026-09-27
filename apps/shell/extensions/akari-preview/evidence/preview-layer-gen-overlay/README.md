# preview-layer-gen-overlay — 証跡

V1 の上に仮枠ツールで描いた枠（V2 のレイヤー）に、プレビューの生成の表示（淡いオーロラ・生成中の光 + 帯・候補ありの札）が出ることの実機確認。

- 撮影: `scripts/l1.mjs --phase=before|after`（開発ビルドの Electron・CDP 9645・HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData を一時ディレクトリに隔離・一時プロジェクト 1920×1080）
- 画像生成はスタブ（`scripts/stub-bin/` → `scripts/stub-image-cli.mjs`。手段ごとの寸法と待ち時間で PNG を書くだけ。gen-ux-polish-b の証跡から複製）。有償 API は呼ばない
- BEFORE = まとめブランチの基点のビルド / AFTER = 本ブランチのビルド。同じスクリプト

| 画面 | BEFORE | AFTER |
|---|---|---|
| (i) V2 のレイヤーの空の枠 | 表示なし（灰色の文字カードのまま） | 枠の位置・大きさに淡いオーロラ + 「planned · 空の枠」 |
| (ii) 3 手段の同時生成中 | 表示なし | 生成中の光（シマー + ✦）+ 帯「生成中 · N 秒」（秒が進む） |
| (iii) 候補あり | 表示なし | 札「候補 3 · 空の枠」 |
| (v1) V1 の cut の空の枠（回帰確認） | 全面に淡いオーロラ | 同じ |

- `*-preview.png` はプレビューだけ、`*-timeline.png` はタイムラインだけを切り出したもの。枠の位置と大きさは、プレビューの選択枠（レイヤーの実際の描画範囲）との差が 2% 以内であることを `results-*.json` の `box` / `selectBox` で確かめた
- 判定: `results-before.json` 3/11・`results-after.json` 11/11

## r1（差し戻し: オーロラをはっきり・下の文字カードを隠す・札を日本語）

- 撮影: `scripts/l1.mjs --phase=r1`（r0 と同じ隔離・スタブ。V1 の cut でも生成中・候補ありまで回すよう拡張）
- 各画面で生成の表示の枠だけを切り出した `r1-*-overlay.png` を ffmpeg で 1×1 に縮めて平均色を測り、`::before` の下地の不透明度（0.85 以上）とグラデーションを読んで判定（灰色の文字カードが透けていると R/G/B がほぼ同じになる）
- 判定: `results-r1.json` 14/14

| 画面 | 札 | 平均色 (R,G,B) | 流れ |
|---|---|---|---|
| (i) V2 のレイヤーの空の枠 `r1-i-layer-empty-preview.png` | ✦ AI の枠 | 77,87,130 | なし（✦ 静止） |
| (ii) V2 のレイヤーの生成中 `r1-ii-layer-generating-preview.png` | 生成中 · 空の枠 + 帯「生成中 · N 秒」 | 76,77,122 | akari-gen-drift 6 秒 + 光 + ✦ 明滅 |
| (iii) V2 のレイヤーの候補あり `r1-iii-layer-candidates-preview.png` | ✦ 候補 3 | 78,88,131 | なし |
| (v1-i) V1 の cut の空の枠 `r1-v1-cut-empty-preview.png` | ✦ AI の枠 | 70,83,132 | なし |
| (v1-ii) V1 の cut の生成中 `r1-v1-cut-generating-preview.png` | 生成中 · 空の枠 + 帯 | 94,80,140 | akari-gen-drift + 光 + ✦ 明滅 |
| (v1-iii) V1 の cut の候補あり `r1-v1-cut-candidates-preview.png` | ✦ 候補 3 | 70,84,133 | なし |
