# 生成 v0 契約 — 仮枠クリップ・9 スロット・meta.json・能力カタログ・状態

> 正本の写し（2026-09-13）・技術部分のみ。内部正本の §1〜§9 を公開向けに収録する。

## 1. 継ぎ目（仮枠とタイムライン）

1. 仮枠は **edit.json v2 の media item** で、`sources[].path` が静止画（png / jpg）か文字カード png を指す。cuts で尺を持つ（静止画クリップ契約 2026-08-12 のとおり）
2. 生成の意図と状態は、その素材の隣の **`<path>.meta.json`** に持つ（§3）。edit.json には何も足さない
3. meta と素材の結線は **素材の sha256** が正。path は手掛かり。移動・改名は path を更新、複製は同じ meta を共有してよい（sha256 が同じ）
4. 「動画にする」は同じ item の `source.path` を mp4 に書き換える**差し替え**であり、item id・トラック・尺は変わらない（§7）
5. 絵コンテはタイムラインの印刷（9/6 §5）。生成の入力にしない
6. plan.json の仮枠役（`confidence` / `fill`）は退役。`plan-comments.json` の `pass: "scaffold"` の対象は `slot` から **clip id** へ

## 2. 9 スロット（生成入力の正規形）

すべてのモデルに対して、入力はこの 9 つのどれかに落とす。アダプタが provider の引数名に翻訳する（§5）。

| # | スロット | 型 | 備考 |
|---|---|---|---|
| ① | `prompt` / `negative_prompt` | string / string?  | 動きの記法（⑧）は prompt に合成してから送る |
| ② | `first_frame` | 参照要素? | 既定 = そのクリップの静止画。**任意**（H3 は最後だけでも生成できる） |
| ③ | `last_frame` | 参照要素? | 対応は主要 7 家。非対応モデルで値があれば検証エラー |
| ④ | `reference_images[]` | 参照要素[] | 上限はカタログ。`name` / `role` はモデルが要求するときだけ使う |
| ⑤ | `reference_videos[]` | 参照要素[] | 本数と合計秒。**動きを真似る元**（貼り込まれない） |
| ⑥ | `reference_audios[]` | 参照要素[] | 既定候補 = クリップ範囲のナレーション。Wan の BGM 添付はここに入れない |
| ⑦ | `source_video` + `mode` | 参照要素? + `edit` / `extend` / `motion` / `frame-edit` | **続ける・直す元**。v1 は欄のみ |
| ⑧ | `camera` | `{ notation: "bracket" / "trajectory" / "prose", value, from_annotation? }` | 注釈ペンからの翻訳先。notation はモデルに合わせてアダプタが選ぶ。**絵には焼かない** |
| ⑨ | `seed` | integer? | 再現用の表示のみ。決定論は保証しない |
| 出力ノブ | `duration_s` / `resolution` / `aspect` / `audio_out` | number / string? / string? / boolean? | 尺は cuts から。モデルの許容に丸め、丸めた事実を表示 |
| 逃げ道 | `extra` | object | モデル固有の引数。**カタログ行の `extra_allowed[]` にある名前だけ**通す |

参照要素 = `{ path, sha256, source_id?, name?, role?, range_s?: [in, out] }`。path はプロジェクト相対。

## 3. meta.json v1（素材サイドカー）

置き場: 生成物は `assets/generated/<file>`、サイドカーは `assets/generated/<file>.meta.json`。実写や既存素材から生成するときも、**生成物の隣**に置く（元素材の隣ではない）。

```json
{
  "version": 1,
  "kind": "video",                       // "still" | "video" | "frames"
  "status": "done",                      // "planned" | "generating" | "done" | "failed"
  "model": { "id": "fal:h3-i2v", "endpoint": "minimax/h3/image-to-video", "as_of": "2026-09-12" },
  "inputs": {                            // §2 の 9 スロット。値の無いスロットは null / []
    "prompt": "…", "negative_prompt": null,
    "first_frame": { "path": "assets/stills/s03-leaving-desk.png", "sha256": "…", "source_id": "src-03a" },
    "last_frame":  { "path": "assets/stills/s03-family-garden.png", "sha256": "…", "source_id": "src-03b" },
    "reference_images": [], "reference_videos": [], "reference_audios": [],
    "source_video": null,
    "camera": { "notation": "bracket", "value": "[Tracking shot]", "from_annotation": null },
    "seed": null, "extra": {}
  },
  "output": { "duration_s": 6, "resolution": "768P", "aspect": null, "audio_out": null },
  "cost": { "estimate_usd": 0.36, "actual_usd": null, "unit": "usd_per_second", "source": "estimate" },
  "job": { "provider": "fal", "request_id": "01a0…", "status_url": "…", "response_url": "…", "started_at": "2026-09-13T…", "stale_after_s": 900 },
  "provenance": { "created_at": "…", "tool": "akari generate video", "key_source": "env:FAL_KEY" },
  "result": { "path": "assets/generated/s03-leaving-to-garden.mp4", "sha256": "…", "bytes": 0, "duration_s_actual": 6.592,
              "width": 1344, "height": 768, "fps": "24/1", "has_audio": true, "expanded_prompt": "…", "elapsed_s": 206 },
  "history": [ { "at": "…", "status": "done", "reason": null } ]
}
```

規則:

1. **送る前に `job` を書く**（request_id・started_at）。落ちても再取得できる（`akari generate resume`）
2. `status: generating` かつ `started_at` から `stale_after_s` 超 = **stale**。シェルは「応答なし・再取得」を出す。既定 900 秒
3. 状態の遷移は undo に入れない。**差し替え（§7）だけ** edit-store の undo に 1 手として入る
4. `history[]` は消さない。失敗も残す
5. `kind: "still"` は `inputs.reference_images` に `--image=` の 1 枚（Codex）か複数枚（Nano Banana Pro）。`kind: "frames"` はパラパラ（別契約・§10）
6. `result.expanded_prompt` は provider が書き換えた prompt。較正では **送った prompt ではなく expanded を評価対象**に添える

## 4. 能力カタログ `gen-models.json`（公開リポ `packages/schemas/`）

### 4-1. 形（1 行 = 1 エンドポイント）

```json
{
  "id": "fal:h3-i2v", "kind": "video", "provider": "fal", "family": "MiniMax H3",
  "endpoint": "minimax/h3/image-to-video",
  "inputs": {
    "first_frame": "optional", "last_frame": "optional",
    "reference_images": { "max": 0 }, "reference_videos": { "max": 0 }, "reference_audios": { "max": 0 },
    "source_video": [], "frames_and_refs_exclusive": false,
    "negative_prompt": false, "camera": "bracket", "extra_allowed": ["prompt_expansion_mode"]
  },
  "duration": { "kind": "range", "min": 5, "max": 15, "step": 1, "default": 5, "format": { "type": "integer" } },
  "resolutions": ["480P", "768P", "2K", "4K"], "aspects": null,
  "audio_out": "always",
  "seed": true,
  "price": { "unit": "usd_per_second", "by_resolution": { "480P": 0.05, "768P": 0.06, "2K": 0.13, "4K": 0.16 }, "audio_multiplier": null },
  "as_of": "2026-09-12",
  "source_url": "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/image-to-video",
  "price_url": "https://fal.ai/models/minimax/h3/image-to-video",
  "verified": "documented",
  "calibration": ["calibration/2026-08-23-camera-direction", "lab/2026-09-13-w0-spikes"]
}
```

- `inputs.first_frame` / `last_frame` は `"required"` / `"optional"` / `"none"` の 3 値
- `duration.format` は `{type: "integer"}` / `{type: "string"}` / `{type: "string", suffix: "s"}` / `{type: "string", auto: true}`
- `audio_out` は `true`（切替可）/ `"always"`（欄なしで付く）/ `false`
- `price` は **null 可**（B-1）。null の行は UI が「見積不可」と出し、明示確認で通す

### 4-2. 7 規律（旧 Akari OS の欠陥の否定形。w1 の受け入れ条件）

1. 能力は真偽と上限の欄で持つ。`capability` スラッグを作らない
2. 写像表に無いスロットに値が来たら**送らずに失敗**（fail closed）
3. バリデータ 1 本を CLI・シェル UI・エージェントで共用
4. 全欄必須・`additionalProperties: false`
5. `verified: "documented"` の行だけ収載。推定行は内部リポの下書き
6. 主観点数を持たない。価格・尺・入力・音声・`calibration[]` だけ
7. レーダーを作らない

### 4-3. 初期収載 12 行

Kling v3 standard i2v / Kling v3 pro i2v / Veo 3.1 first-last / Veo 3.1 reference / Seedance 2.0 i2v / Seedance 2.0 reference / Seedance 2.5 i2v / H3 i2v / H3 reference / Wan 2.7 i2v / Grok Imagine i2v / Vidu Q3 i2v。画像: codex-image / nano-banana-pro edit。Sora は OpenAI 直アダプタが出来るまで入れない。

### 4-4. 鮮度とドリフト

- `as_of` 必須。UI の費用表示に日付を添える
- 週次 CI: `source_url` の OpenAPI を取り、行の `inputs` / `duration` / `resolutions` と突き合わせる。差分があれば issue（価格は対象外。価格は `price_url` を人が見る）
- OpenAPI が取れない provider の行は `as_of` から 90 日で WARN

## 5. アダプタ契約（9 スロット → provider 引数）

### 5-1. 写像表

各アダプタは 9 スロット × 出力ノブの**全セル**に「引数名 + 書式」か「拒否」を持つ。テストは全セルを網羅する。

### 5-2. 尺の書式（スパイク実測）

| モデル | 送る形 |
|---|---|
| H3 | integer `6` |
| Kling v3 | string `"6"` |
| Seedance 2.0 | string `"6"`（`"auto"` 可） |
| Veo 3.1 | string `"6s"`（4 / 6 / 8 のみ。丸め必須） |

### 5-3. 参照の渡し方

- 画像は data URI で送ってよい（5.2 MB で 24 秒）。**20 MB 超は fal storage へ先にアップロード**（後日）
- 順序タグ（@Image1 …）はアダプタが配列順から生成して prompt に付ける。名前 + 役割（PixVerse）は要素の `name` / `role` から
- 参照音声は `range_s` で切り出してから送る（クリップ範囲だけ）

## 6. 状態と見え方

| 状態 | タイムライン | プレビュー（編集中） | 書き出し |
|---|---|---|---|
| `planned`（文字カード） | 点線 + 「planned」 | 文字カード + 左上小札 | 文字カードのまま。lint WARN |
| 静止画（meta なし or `done` の still） | 「静止画」バッジ | 静止画 + 左上小札「静止画（仮枠）」 | そのまま。小札なし |
| `generating` | 黄の縞 + 進捗バー | 静止画の上にシマー + 下端の帯 | 静止画のまま |
| stale | 縞 + 「応答なし・再取得」 | 帯に「応答なし」 | 静止画のまま |
| `done`（動画） | 通常 + コマ帯 + 「生成」由来バッジ | 動画。表示なし | 通常 |
| `failed` | 朱枠 + 「失敗」 | 静止画 + 朱の小札 | 静止画のまま |

- プレビューに付くのは**左上の小札と下端の帯だけ**。承認・比較の UI はプレビューに置かない
- **書き出し経路には小札・帯・点線が 0 px**。画素比較で担保（w3-b）

## 7. 差し替え規則（done になったとき）

### 7-1. 何を書き換えるか

同じ item の `sources[].path` を mp4 に。item id・トラック・`at` は不変。静止画の path は `meta.inputs.first_frame` に残る（由来）。**1 手の undo**。

### 7-2. 実尺のずれ

| 実尺 | 規則 |
|---|---|
| 実尺 ≥ cuts | `out = cuts の長さ`（末尾を切る）。差分は meta に記録 |
| 実尺 < cuts | `out = 実尺`、`freeze: { at_sec: 実尺, duration_sec: cuts − 実尺 }`（既存の `cutFreeze` 語彙。lint `media.source-range` を通り、タイムライン総尺は不変。**最終コマ停止**） |

差分が 0.5 秒超なら lint が WARN（`generation.duration-mismatch`。lint 側の新規則は w2-b の別票候補）。

### 7-3. 音声

生成クリップの音声トラックは**既定 mute**（`item.mute: true`）。ナレーションと BGM が正。右パネルで解除できる。H3 のように欄なしで音が付くモデルでも同じ。

## 8. 費用承認（有償生成のゲート）

1. 語彙: 有償生成の承認は「**費用承認**」。「判子」は 9/6 契約どおり書き出しの 1 回にだけ使う
2. 回数: 1 クリップずつが既定。複数を選んで**合計金額を出して 1 回**は可。「全部を自動で動画にする」は無い
3. 見積: `price.by_resolution × duration_s × audio_multiplier`、as_of 付き。`actual_usd` が取れない provider は `estimate` を写して `cost.source: "estimate"`。見積不可（price null）は明示確認で通す
4. 停止条件は autonomy §4 と同じ（有償 or 外部送信）。Codex 画像生成は無償扱い

## 9. 用語（混同を防ぐ）

| 語 | 意味 |
|---|---|
| 仮枠 | 尺と場所を持つ静止画クリップ。完成品でもある |
| 参照動画 | 動きやカメラワークを**真似る元**。貼り込まれない |
| 元動画 | **続ける・直す元**（extend / edit / motion / frame-edit） |
| 費用承認 | 有償生成の実行前ゲート |
| 判子 | 書き出しの 1 回（9/6） |
| 事実帯 | モデル選択の 1 行（価格・尺・入力・音声・較正）。レーダーの代わり |

