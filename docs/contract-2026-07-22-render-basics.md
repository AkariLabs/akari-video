# レンダー基礎機能契約（速度 / クロマキー背景置換 / 基本トランジション / LUT / 音声マスター処理）

- 日付: 2026-07-22
- 状態: **draft**（実装と並走で approved 化）。本書は技術仕様のみ。
  判断経緯・実装レーンの運用は非公開の内部記録で管理する（本リポには置かない方針）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（三原則）、
  `contract-2026-07-13-m1-m4.md`（edit.json 正本）、
  `contract-2026-07-14-edit-json-v1-audio.md`（audio スキーマ）
- 大原則: **done = 出力ファイルに現れる**。全項目、実レンダリング出力の機械検証を
  受け入れ条件とする（仕様先行・バックエンドの silent drop を許さない —
  schema・実装・lint・出力検証を同時に納品する）

## 1. スコープ（5 機能・いずれも ffmpeg 直結）

| # | 機能 | edit.json 拡張（追記のみ） | ffmpeg 実装 | 出力検証 |
|---|---|---|---|---|
| 1 | 定速変更（クリップ単位の倍速/スロー） | `cuts[].speed`（number・既定 1.0・v0 は定速のみ、ランプは将来） | `setpts` + `atempo`（>2x/<0.5x の段組み） | 出力尺が理論値と一致（ffprobe）・音程/同期の実聴確認 1 点 |
| 2 | クロマキー背景置換 | `source.chroma_key`: {color, similarity, blend, background(色 or 画像/動画パス)} | `chromakey`/`colorkey` + 背景入力の `overlay` | 緑背景フィクスチャで背景が置換された出力のピクセルサンプル検証 |
| 3 | 基本トランジション | `cuts[].transition_out`: {type: dissolve/fade-black/fade-white, duration} | `xfade`（transition 指定があるカット境界のみ xfade 経路） | 境界フレームの中間ブレンド実在をフレーム抽出で確認・指定なし境界はハードカット維持 |
| 4 | 色調フィルター（LUT） | `output.look`: {lut(カタログ参照 or パス), intensity} | `lut3d`（intensity は `blend` 併用） | LUT 有無 2 出力のフレームピクセル差分・カタログ `catalog/luts/`（初期 2〜3 本） |
| 5 | 音声マスター処理 | `audio.master`: {denoise(off/std/strong), loudnorm(target LUFS・既定 -14)} | `afftdn` / `loudnorm`（2 パスでなく 1 パス許容 v0） | 出力のラウドネス実測（ffmpeg ebur128）が目標 ±1LU |

- 除外（次段送り）: ブレンドモード・PinP・プリレンダ合成レール（レイヤー機構が前提のため）

## 2. 横断要件

1. schema は**追記のみ**（既存 edit.json が全て無変更で valid のまま）。validate-edit /
   edit-lint / fixtures / test を同時追随
2. プレビュー（preview-engine）は v0 では**近似不要・無視でよい**（出力最優先。
   「プレビューは近似・書き出しが正」の哲学を全項目に適用。プレビュー追随は別契約）

## 3. 残裁定

1. `speed` の音声ピッチ保持（atempo = ピッチ維持）を既定とするか、ピッチ変動オプションを持つか
2. LUT 初期カタログの中身の選定
3. xfade 移行で render-cut の concat 構造をどこまで作り替えるか（v0 = 指定境界のみ / 全面 xfade 化）
