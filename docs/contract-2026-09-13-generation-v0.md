# 生成 v0 契約 — 仮枠クリップ・9 スロット・meta.json・能力カタログ・状態

> 正本の写し（2026-09-13・2026-09-21 改訂）・技術部分のみ。内部正本の §1〜§9 と §11 を公開向けに収録する。
> 節番号の対応: 本書 §1〜§9 = 内部正本 §1〜§9、本書 §10（コマ保存）= 内部正本 §11。

### 0-5. 裁定 D（確定・2026-09-23）

| # | 決定 | 理由 |
|---|---|---|
| D-1 | **音の空の枠** = 枠の長さの無音 wav を素材に持つ音声の media item。隣の meta.json は `kind: "audio"`・`status: "planned"`。置き場は映像の空の枠と同じ `assets/generated/` | ナレーションの差し替え先にできる |
| D-2 | **音声トラックの表示名は上から数える**（映像に近い方が A1、下へ A2, A3）。映像は下から（V1 がいちばん下の映像）。edit.json の `tracks[]` の並び・id は変えない | A1 の下に足したトラックが A2 になり、A1 の名前を保てる |

## 1. 継ぎ目（仮枠とタイムライン）

1. 仮枠は **edit.json v2 の media item** で、`sources[].path` が静止画（png / jpg）か文字カード png を指す。cuts で尺を持つ（静止画クリップ契約 2026-08-12 のとおり）
2. 生成の意図と状態は、その素材の隣の **`<path>.meta.json`** に持つ（§3）。edit.json には何も足さない
3. meta と素材の結線は **素材の sha256** が正。path は手掛かり。移動・改名は path を更新、複製は同じ meta を共有してよい（sha256 が同じ）
4. 「動画にする」は同じ item の `source.path` を mp4 に書き換える**差し替え**であり、item id・トラック・尺は変わらない（§7）
5. 絵コンテはタイムラインの印刷（9/6 §5）。生成の入力にしない
6. plan.json の仮枠役（`confidence` / `fill`）は退役。`plan-comments.json` の `pass: "scaffold"` の対象は `slot` から **clip id** へ
7. **空の枠**（2026-09-21）: 仮枠ツール（F）で空いているところに描いた枠は、prompt 未記入の**文字カード png** を素材に持つ media item（絵のないクリップを文字カード png で表す規則の延長）。0.5 秒刻み・端に吸着・隣に食い込まない・0.5 秒未満にしない。専用トラックは作らない（どのトラックにも置ける）
   実装: 選択 V / 分割 C / 仮枠 F（従来の A / B も有効）。仮枠はスナップ OFF でも近い可視端・再生ヘッドを 0.5 秒格子より優先し、`assets/generated/frame-<時刻>-<一意接尾辞>.png` と隣の `.meta.json` に保存する。
   音声トラックにも無音 wav の枠を描ける。トラックの無い場所では上に映像トラック、下に音声トラックを足して置き、undo 1 回で追加したトラック・枠・source を消す。
8. **すき間から作る枠**（2026-09-21）: すき間をクリック →「あいだを生成」で、すき間の位置と長さの枠を置く。前のクリップの最後のコマ・次のクリップの最初のコマを抽出して両端（②③）に入れる。動画からの抽出は 1 コマを `assets/captures/` へ書き出す（§10）
   実装: 同じ映像トラックで前後にクリップがある 0.5 秒以上の空きだけをすき間とする。前は `source.out − 1/output.fps`（in 以上）、次は `source.in` の合成前のコマを使い、静止画は元パスを使う。
   抽出 PNG は `assets/captures/frame-<素材名>-<秒>-<素材・更新時刻等のハッシュ>.png` に保存し、同じ素材・同じ時刻は再利用する。
9. 枠は**生成前から尺と場所を持ち、生成物は同じ item に入る**（4 の延長）。メディアパネルは経由しない（タイムライン正本）

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

meta の無い静止画は、最初に下書きを書くときにシェルが `kind: still, status: done`（取り込み画像）の meta を新設する。動画・音声・html には新設しない。

```json
{
  "version": 1,
  "kind": "video",                       // "still" | "video" | "frames" | "audio"（音の空の枠）
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
5. `kind: "still"` は `inputs.reference_images` に `--image=` の 1 枚（Codex）か複数枚（Nano Banana Pro）。`kind: "frames"` はパラパラ（別契約）
6. `result.expanded_prompt` は provider が書き換えた prompt。較正では **送った prompt ではなく expanded を評価対象**に添える

### 3-2. 動画予定の下書き `next`（2026-09-21）

mp4 がまだ無い「動画予定」は、**仮枠の素材の meta**（静止画なら `<still>.meta.json`、空の枠なら文字カードの meta）の中に `next` ブロックで持つ。

```json
{
  "version": 1, "kind": "still", "status": "done",          // 静止画自身の記録はそのまま
  "…": "…",
  "next": {
    "kind": "video", "status": "planned",
    "model": { "id": "fal:h3-i2v" },
    "inputs": { "prompt": "…", "first_frame": { "path": "…", "sha256": "…" }, "last_frame": null,
                "reference_images": [], "reference_videos": [], "reference_audios": [],
                "camera": null, "seed": null, "extra": {}, "frames_or_refs": "frames" },
    "output": { "duration_s": 5, "resolution": "768P", "aspect": null, "audio_out": null },
    "updated_at": "…"
  }
}
```

1. **読み手の判定**: `next.kind === "video"` かつ `next.status === "planned"` = 「動画予定」。`next` が無い静止画 = 「画像のまま」= 完成品。文字カード（meta 自体が `planned`）で `next` が無いか prompt が空 = 「空の枠」
2. `next.inputs` は §2 の 9 スロットの下書き。`first_frame` は**そのクリップの絵とは限らない**（前のクリップの最後のコマ・キャプチャ・空 = プロンプトだけ）
3. **`inputs.frames_or_refs`** = `"frames"` / `"references"`（`next` の下書きだけが持つ欄。§2 ⑦ の `mode` = 元動画のモードとは別物）。最初 / 最後と参照が排他のとき（`frames_and_refs_exclusive: true` の行、または同じ family の i2v 行と ref 行の切替）、**下書きは両側を保持し、送るのは `frames_or_refs` の側だけ**。切り替えで中身を消さない。バリデータはこの欄を見て反対側を送信 body から外し、生成物 meta の `inputs` にはこの欄を書かない（送った側だけが残る）
   右パネルは同じ family のフレーム行 / 参照行を「最初 / 最後｜参照」で切り替え、model ID も相方に替える。参照は種類別の札・カウンタ付きグリッドで、素材パネルから複数選択する。
4. **送るとき**: CLI は `next`（または `--inputs`）を読み、従来どおり**生成物の隣**に video meta（`generating`）を書く。このとき **`placeholder: { path, sha256, item_id }`** = その item が今指している素材（静止画 / 文字カード）を必ず書く。item への逆引きは `placeholder` が正、`inputs.first_frame.path` は 9/13 時点の meta のための後方互換。`next` は消さない（「同じ入力でもう一度」の元）
5. **状態の優先**: `placeholder` で結線された生成物 meta が `generating` / stale / `failed` ならそれを描く。無ければ `next` の `planned` を描く。`done` で差し替わった後は mp4 の meta が直接当たる（§7）
   done で差し替わった後の作り直し（本番の画質・同じ入力でもう一度）の下書きは、mp4 の meta の `next` に持つ。元の静止画の `next` は変えない。
6. `next` の更新は undo に入れない（§3 規則 3 と同じ）。右パネルの編集は即保存
7. 移行: `.akari/generation/<itemId>.inputs.json` があり `next` が無いときだけ読み、次の保存で `next` へ移す。新規の書き込みはしない
8. ビート表（`akari generate still --spec`）はビートごとに動画予定（最初だけ / 最初→最後）を指定でき、指定があれば CLI が `next` を書く。指定が無ければ「画像のまま」

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

- 参照の順序記法は行ごとの `tag`（接頭辞）+ `tag_joiner`（省略時は空文字）+ 1 始まりの番号。Seedance は `@Image` + 空文字 → `@Image1`、H3 は `Image` + 空白 → `Image 1`。動画・音声も同様。`tag` の末尾に空白は入れない
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

動画の登録済みアダプタ（2026-09-22）は `fal:h3-i2v`・`fal:h3-ref`・`fal:kling-v3-standard-i2v`・`fal:kling-v3-pro-i2v`・`fal:seedance-2.0-i2v`・`fal:seedance-2.0-ref`・`fal:veo-3.1-flf` の 7 行。カタログ収載だけでは送信できない。H3 reference は OpenAPI に従い `Image 1` / `Video 1` / `Audio 1` で参照を名指しする。`first_frame` / `last_frame` は拒否する。

### 4-4. 鮮度とドリフト

- `as_of` 必須。UI の費用表示に日付を添える
- 週次 CI: `source_url` の OpenAPI を取り、行の `inputs` / `duration` / `resolutions` と突き合わせる。差分があれば issue（価格は対象外。価格は `price_url` を人が見る）
- OpenAPI が取れない provider の行は `as_of` から 90 日で WARN

## 5. アダプタ契約（9 スロット → provider 引数）

### 5-1. 写像表

各アダプタは 9 スロット × 出力ノブの**全セル**に「引数名 + 書式」か「拒否」を持つ。テストは全セルを網羅する。

対応一覧は §4-3 の 6 行。Seedance 2.0 reference は画像・動画・音声参照を写し、`first_frame` / `last_frame` / `seed` は拒否する。参照用の OpenAPI 根拠は `packages/generate/test/fixtures/openapi/`（2026-09-22 取得・URL と SHA-256 は同 README）に保存する。H3 reference は記法の不一致が解消するまで登録しない。

### 5-2. 尺の書式（スパイク実測）

| モデル | 送る形 |
|---|---|
| H3 | integer `6` |
| Kling v3 | string `"6"` |
| Seedance 2.0 | string `"6"`（`"auto"` 可） |
| Veo 3.1 | string `"6s"`（4 / 6 / 8 のみ。丸め必須） |

### 5-3. 参照の渡し方

- Seedance 2.0 reference と H3 reference の画像・動画・音声は配列順のまま data URI で送る。**20 MB 超は送らず error**（fal storage へのアップロードは後日）。OpenAPI の上限は画像 9・動画 3・音声 3、全種合計 12 ファイル。Seedance の音声参照には画像か動画が 1 本以上必要。H3 は 2026-09-22 取得の OpenAPI に従い音声単独も可
- 引数名は Seedance が `image_urls` / `video_urls` / `audio_urls`、H3 が `reference_image_urls` / `reference_video_urls` / `reference_audio_urls`。OpenAPI の正本は `packages/schemas/fixtures/gen-models/openapi/`。generate のテストも相対 URL でこの正本を直接読む。`packages/generate/test/fixtures/openapi/` は取得記録の README のみ（取得日・出典・変換方法を記録）
- 順序タグはカタログ行の `tag` + `tag_joiner`（省略時は空文字）+ 配列順の番号（1 始まり）。prompt の `@画像N` / `@動画N` / `@音声N` を、Seedance では `@ImageN` / `@VideoN` / `@AudioN`、H3 では `Image N` / `Video N` / `Audio N` へ置換する。該当種別の本数を超える番号や 0 以下・非整数は送らず error。provider 記法の直書きは `@` 付きだけ番号を検査する。H3 の素の英語は検査・置換せず、通常文の `Image 1 of 3` や `Image 3` を誤って拒否しない。名指しが無ければ prompt に何も足さない。名前 + 役割（PixVerse）は要素の `name` / `role` から
- 参照音声は `range_s` があれば media-bin の ffmpeg で切り出してから送る（クリップ範囲だけ）。指定が無ければ元の音声をそのまま送る。切り出しの一時ファイルは成功・失敗ともに削除する

## 6. 状態と見え方

| 状態 | タイムライン | プレビュー（編集中） | 書き出し |
|---|---|---|---|
| 空の枠（文字カード・`next` なし or prompt 空） | 点線 + 「planned」 | 文字カード + 左上小札 | 文字カードのまま。lint WARN |
| **動画予定**（`next` = video · planned。§3-2） | **紫の点線 + 上下のフィルムの穴 + 「▶ 動画予定」**。中身は 最初の絵 1 枚 ・ 生成で埋める空き ・ 最後の絵 1 枚（同じ絵を並べない）。プロンプトだけは文字。最後の絵 = 次のクリップの絵なら境目に 🔗 | 左上小札「▶ 動画予定 · <種類>」+ 最後の絵があれば右下の小窓 | 静止画 / 文字カードのまま。小札・小窓 0 px |
| 静止画 = 画像のまま（`next` なし） | 「静止画」バッジ | 静止画。**小札なし**（完成品） | そのまま |
| `generating` | 黄の縞 + 進捗バー | **参照の絵をぼかした背景** + シマー + 下端の帯。進捗は擬似でなく provider の状態 | 静止画のまま |
| stale | 縞 + 「応答なし・再取得」 | 帯に「応答なし」 | 静止画のまま |
| `done`（動画） | 通常 + コマ帯 + 「生成」由来バッジ | 動画。表示なし | 通常 |
| `failed` | 朱枠 + 「失敗」+ **「同じ入力でもう一度」** | 静止画 + 朱の小札 | 静止画のまま |

- プレビューに付くのは**左上の小札・下端の帯・動画予定の右下の小窓・コマ保存のカメラボタン（§10）だけ**。承認・比較の UI はプレビューに置かない
- 種類の表示は「プロンプトだけ / 画像から / 最初→最後 / 参照から」。枠を埋めたかで決まり、モード選択の UI は作らない
- 失敗の「同じ入力でもう一度」はクリップと右パネルの両方に出す
- **書き出し経路には小札・帯・点線が 0 px**。画素比較で担保（w3-b）

## 7. 差し替え規則（done になったとき）

空の枠・静止画は AI タブの「静止画」（Codex）で作った絵へ差し替えられる。item と映像・色の設定を保ち、差し替えは undo 1 回で戻る。
静止画の手段 = Codex / Antigravity / Grok（サインイン経由・従量の鍵は外して呼ぶ）。

### 7-1. 何を書き換えるか

同じ item の `sources[].path` を mp4 に。item id・トラック・`at` は不変。静止画の path は生成物 meta の `placeholder`（§3-2）に残る（由来。9/13 時点の meta は `inputs.first_frame`）。**1 手の undo**。

**クリップ側の設定は保持する**（2026-09-21）。変形（拡大率・位置・不透明度・反転）と色（LUT・明るさ等）は item の上に重ねる設定であり、差し替えで入れ替わるのは**素材だけ**。逆に、**生成に送る絵は素材のまま**で、クリップの LUT・サイズは送らない（キャプチャを枠に入れた場合は §10-2）。

### 7-2. 実尺のずれ

| 実尺 | 規則 |
|---|---|
| 実尺 ≥ cuts | `out = cuts の長さ`（末尾を切る）。差分は meta に記録 |
| 実尺 < cuts | `out = 実尺`、`freeze: { at_sec: 実尺, duration_sec: cuts − 実尺 }`（既存の `cutFreeze` 語彙。lint `media.source-range` を通り、タイムライン総尺は不変。**最終コマ停止**） |

差分が 0.5 秒超なら lint が WARN（`generation.duration-mismatch`。lint 側の新規則は w2-b の別票候補）。

### 7-3. 音声

生成クリップの音声トラックは**既定 mute**（`item.mute: true`）。ナレーションと BGM が正。右パネルで解除できる。H3 のように欄なしで音が付くモデルでも同じ。

音の空の枠は AI タブのナレーションで声の素材へ差し替える。声が枠より長く、同じトラックの後ろに重なる場合は下の空いた音声トラックへ置き、既存のクリップは動かさない。

## 8. 費用承認（有償生成のゲート）

1. 語彙: 有償生成の承認は「**費用承認**」。「判子」は 9/6 契約どおり書き出しの 1 回にだけ使う
2. 回数: 1 クリップずつが既定。複数を選んで**合計金額を出して 1 回**は可。「全部を自動で動画にする」は無い。複数選択時の右パネル（対象一覧 + 合計見積 + まとめて費用承認 1 回）を正の UI とする。対象外（画像のまま・空の枠・生成済み）は送らない。見積は送信ボタンの横に常時出す
3. 見積: `price.by_resolution × duration_s × audio_multiplier`、as_of 付き。`actual_usd` が取れない provider は `estimate` を写して `cost.source: "estimate"`。見積不可（price null）は明示確認で通す
4. 停止条件は autonomy §4 と同じ（有償 or 外部送信）。Codex 画像生成は無償扱い

## 9. 用語（混同を防ぐ）

右パネルのタブ表示名は「AI」（id は `generation`）。入口は行為のタイル一覧で、選ぶと既存の生成フォームを専用パネルに表示する。
AI タブの「直す」に文字起こしを置き、台本パネルの処理を呼ぶ。済みなら字幕を見せる。
素材の AI タブは素材パネルで選ぶと右パネルに表示し、結果は新しい素材として増やす（文字起こしは台本）。

| 語 | 意味 |
|---|---|
| 仮枠 | 尺と場所を持つ静止画クリップ。完成品でもある |
| 動画予定 | 仮枠に動画生成の下書き（`next`）が付いた状態。mp4 はまだ無い |
| 空の枠 | 絵も prompt もまだ無い仮枠（文字カード） |
| 画像のまま | 動画にしない静止画クリップ。完成品 |
| 参照動画 | 動きやカメラワークを**真似る元**。貼り込まれない |
| 元動画 | **続ける・直す元**（extend / edit / motion / frame-edit） |
| 費用承認 | 有償生成の実行前ゲート |
| 判子 | 書き出しの 1 回（9/6） |
| 事実帯 | モデル選択の 1 行（価格・尺・入力・音声・較正）。レーダーの代わり |
| 下書き → 本番の画質 | `price.by_resolution` に異なる単価が 2 つ以上ある video 行だけ対応。下書きは最安解像度。チェック ON は `next.output.resolution` を最安にして解像度を固定、OFF は直前の選択（無ければカタログ順の既定）へ戻し、見積を再計算する。生成物の `output.resolution` が最安なら下書きと判定し、カタログ・meta に判定用の欄は追加しない。done の `placeholder` を辿った元静止画が存在し `next` を保持している場合だけ「本番の画質にする…」を表示。解像度の初期値は下書き前の選択かカタログの既定で、価格順の 2 番目は使わない。より高い画質を選択 → 見積 → 既存の費用承認 → 同じ `next.inputs`（対応モデルで meta に seed があれば再使用）で生成する。既存の `writeGenerationDraft` で現在の mp4 meta の既存 `next` 欄へ送信下書きを保存し、CLI の `--item` 経路を再利用する。元静止画の `next` は消さず、同じ item の素材だけを §7 に従って差し替え、映像・色の設定を保持する。placeholder が過去の mp4 を指す場合も元静止画まで辿る。表示文言は「同じ入力でもう一度、高い画質で生成します（絵は変わることがあります）」。 |

## 10. コマ保存（キャプチャ）（2026-09-21）

1. プレビューの**カメラのアイコンだけのボタン**（文字なし・絵文字にしない）= 今のコマを **見たまま（合成後・LUT とサイズ込み）** で `assets/captures/frame-<t>.png` に保存し、トーストを出す。素材パネルに出る
2. キャプチャを生成の入力（②③④）に使うときは、**その png が素材**。LUT 込みで撮ったなら込みで送られる（§7-1 の「送る絵は素材のまま」と矛盾しない — 素材がそういう絵である）。UI は枠に入れるとき「見たままのコマ（色・サイズ込み）」と明示する
3. 「あいだを生成」（§1-8）の前後コマ抽出は**素材の画素**（合成前）を使う。見たままが要るときは人がカメラボタンで撮る
4. 書き出し経路にボタンは 0 px（§6）
