# edit.json v1 crop（リフレーミング）契約

- 日付: 2026-07-14
- 状態: 実装ラウンドの SSOT（`cuts[].crop` フィールドのみ確定）
- 前提: `contract-2026-07-13-m1-m4.md`（edit.json v0 の確定契約）、
  `notes-2026-07-13-edit-json-v1.md` §2（本契約はこの節を昇格したもの）、
  `contract-2026-07-14-edit-json-v1-audio.md`（version 運用・劣化規約の先例）
- スコープ: edit.json の `cuts[].crop` フィールド（カット単位のリフレーミング矩形）のみ。
  `notes-2026-07-13-edit-json-v1.md` §3 のレイアウト（複数ソース矩形配置）・§1 の
  出力プロファイル複数化は本契約では扱わない（次段）

## 0. version 運用（後方互換）

**`version` は `0` のまま据え置く。**bump しない。`contract-2026-07-14-edit-json-v1-audio.md`
§0 と同じ判断基準を適用する。

- `cuts[].crop` は `Cut` 要素の**任意フィールド**（`Option`）。存在しなければ v0 と
  完全に同じ挙動（カット全体を対象にした scale + letterbox/pillarbox のみ。crop なし）
- 既存の `cuts[].in` / `cuts[].out` の意味・座標系は一切変更しない。`crop` はそこに
  「このカット区間中、素材フレームのどの矩形を使うか」を追加するだけの加算的フィールド
- notes ファイルが「整数 bump は構造的破壊変更のために温存する」と書いた懸念
  （crop が cuts の意味を変える場合）には該当しない。`crop` 省略時の挙動は
  従来の scale+letterbox と完全に同一であり、既存 edit.json は無改造で動く

## 1. 確定スキーマ

```jsonc
{
  "version": 0,
  "output": { "width": 1080, "height": 1920, "fps": 30 },
  "source": { "path": "sample.mp4", "proxy": null },
  "cuts": [
    { "in": 5.0, "out": 10.0 },                          // crop 省略 = 従来どおり全画面
    { "in": 30.0, "out": 35.0,
      "crop": { "keyframes": [
        { "t": 30.0, "box": [0.2, 0.0, 0.56, 1.0] }        // 正規化座標 [x, y, w, h]
      ] } }
  ]
}
```

### フィールド表

| フィールド | 型 | 必須 | 既定値 | 単位・座標系 |
|---|---|---|---|---|
| `cuts[].crop` | object \| 省略 | 否 | 省略 = crop なし（従来どおり全画面 scale + letterbox/pillarbox） | — |
| `cuts[].crop.keyframes` | array | `crop` があれば必須（最低 1 件） | — | 配列。要素順が意味を持つ（§4） |
| `cuts[].crop.keyframes[].t` | number | 必須（要素内） | — | **source 秒**。`cuts[].in`/`out` と同じ座標系であり、
  `analysis.schema.json` の `tracks.faces[].t` とも同一座標系（§2）。**`audio.sfx[].t` の
  タイムライン秒とは異なる**（§8 よくある間違い） |
| `cuts[].crop.keyframes[].box` | `[number, number, number, number]` | 必須（要素内） | — | 正規化座標 `[x, y, w, h]`。`analysis.schema.json` の `faceBox` と**同一形式**（§7）。
  各要素は 0〜1、意味制約として `x + w <= 1` かつ `y + h <= 1` |

## 2. 座標系 — なぜ `t` が source 秒か

`audio.sfx[].t` は「最終出力のどこで鳴らすか」を表すため**タイムライン秒**
（カット連結後）を採用した（audio 契約 §1）。crop の `t` はこれとは**意図的に異なる**:

- `crop.keyframes[].box` は「**素材フレーム**のどの矩形を切り出すか」という、source 側の
  情報である（`faceBox` の定義「素材フレームに対する…正規化座標」と同じ対象）
- 生成元である `tracks.faces[].t` も source 秒（analysis は素材そのものに対して行う）
- crop はカット（`in`/`out` も source 秒）に**内包される**フィールドなので、`t` を
  source 秒に揃えることで `tracks.faces` からの生成時に**時刻変換が不要**になる
  （§3）。timeline 秒に変換すると、カット順序の並べ替えや将来のトリム編集のたびに
  crop の `t` を再計算する必要が生まれ、SSOT が二重管理になる

`t` は当該 cut の `[in, out]` 範囲内でなければならない（範囲外は生成ミスとみなし
無視する。§5）。

## 3. 生成フロー — `tracks.faces` から `crop` へ

`analysis.schema.json` の `tracks.faces`（`faceTrackPoint` の配列。`speaker` / `t` / `box`
を持つ）が入力。M5 編集判断レポート（`contract-2026-07-13-m5-analysis-report.md`）の
「カット判断一覧」で cut（keep-range）が確定した後、以下の変換を行う:

1. 対象 cut の `[in, out]` に入る `tracks.faces` の点を抽出する（`speaker` で
   主要話者に絞るかは M5 側の判断。本契約は絞り込み後の点列を受け取るだけ）
2. 抽出した点の `t` / `box` を**そのまま** `crop.keyframes[].t` / `.box` にコピーする
   （§2 のとおり座標系が一致するため変換不要）
3. 複数話者が映るカットを縦 2 段などに分割したい場合は crop ではなく
   `notes-2026-07-13-edit-json-v1.md` §3 の**レイアウト**（次段・本契約スコープ外）で扱う

**平滑化・追跡は analysis 側の責務。** `notes-2026-07-13-edit-json-v1.md` §2 の原文
「顔/人物トラック（`tracks.faces`）から生成、平滑化済みの軌跡を持つ」のとおり、
`tracks.faces` を生成する分析パイプラインが**滑らかな軌跡を保証した状態で** `box` を
出力する契約になっている。edit.json / crop 契約側は生の座標をそのまま受け取り、
ジッター除去・追跡アルゴリズムの心配を一切しない（M5 契約「本体は合成だけ」原則と
同じ責務分離）。v1 実装（§4）が「先頭 keyframe のみ採用」であることも、複数点の
軌跡をエンジン側で平滑化する必要がそもそも無いことの裏付けになる。

## 4. v1 実装スコープ

**線形補間は v1 では実装しない。** notes ファイルの案（`keyframes` 配列 = 時間経過での
crop 矩形の変化）は将来の拡張余地として型に残すが、v1 の書き出し実装は以下に限定する:

- `keyframes` が 1 件 → その `box` を当該カット区間全体に**固定 crop**として適用する
- `keyframes` が複数件 → **先頭要素（配列の 0 番目）のみ採用**し、warning を出す
  （t でソートして選ぶのではなく、配列順そのままの 0 番目。生成フロー側は「使いたい
  1 点を先頭に置く」規約で対応する）
- 補間（線形どころか任意の方式）は次段。`keyframes[1]` 以降は v1 では**無視される情報**
  であり、契約上も実装上も「将来のための予約領域」として扱う

このスコープ限定は「深追いしない」という本ラウンドの方針、および §3 で述べた
「平滑化は analysis 側」の設計判断と整合する: v1 は「1 カット = 1 静的 crop」という
最小単位を先に固め、時間経過での動き（パン）は次段で `keyframes` を複数点として
本格的に解釈する形で拡張する。

## 5. 責務分担 — プレビュー（AVFoundation）と書き出し（ffmpeg）

サンドイッチ構造の不変原則（`design-2026-07-13-agent-native-architecture.md`）、
および audio 契約 §3 と同じく「プレビューは近似、正確さは書き出しが持つ」を踏襲する。

| 項目 | プレビュー側（M1 / `video_plane/macos.rs`） | 書き出し側（M4 / `export/ffmpeg.rs`） |
|---|---|---|
| crop の適用 | **本契約のスコープ外・TODO。** v1 実装では `crop` フィールドを無視し、
  従来どおり全画面表示する | `crop=w:h:x:y`（ffmpeg 標準フィルタ）で source フレームを
  切り出してから既存の `scale`+`pad` に接続する |
| 想定する将来実装 | `AVMutableVideoComposition` の `layerInstructions` に
  `setTransform` を適用し、crop 矩形を画面いっぱいに拡大表示する近似 | 変更不要（本契約の実装がそのまま正）|

書き出し側のみを実装するのは、プレビューの transform 実装が M1 の composition 構築
（`macos.rs`）に手を入れる規模の変更であり、本ラウンド（タスク 4 後段・深追いしない）の
範囲を超えるため。プレビューで crop 結果を確認したい場合は、当面は書き出し結果で
判断する（audio 契約 §3 の ducking 近似と同じ運用上の割り切り）。

### ffmpeg 側の実装位置

`cuts[].crop` は per-cut の filter chain（`export/ffmpeg.rs` の `cut_filter`）内、
`trim` の直後・`scale` の直前に挿入する:

```
[0:v]trim=start=..:end=..,setpts=PTS-STARTPTS,crop=w=..:h=..:x=..:y=..,scale=...,pad=...,setsar=1[v{index}]
```

`crop` のピクセル値は `box`（正規化座標）× **source の元解像度**（`ffprobe` で取得した
`probe.width`/`probe.height`。出力解像度 `spec.width`/`spec.height` ではない）から計算する。
crop 後のフレームを既存の `scale=...force_original_aspect_ratio=decrease...,pad=...` に
そのまま渡せば、crop 矩形が出力キャンバスいっぱいに収まるよう自動的にスケール・
レターボックスされる。

## 6. 欠落・不正値時の劣化規約

crop は**演出**であり、そのカット・映像全体の書き出し成否を左右してはならない
（audio 契約 §5・M5 契約「だめなら使わない」と同じ設計哲学）。

| 状況 | 挙動 |
|---|---|
| `cuts[].crop` フィールドなし | 従来どおり（全画面 scale + letterbox/pillarbox）。エラーにしない |
| `crop.keyframes` が空配列 | crop 無視（従来どおり全画面）+ warning。他のカット・書き出し全体には影響しない |
| `crop.keyframes` が複数件 | v1 は先頭要素のみ採用 + warning（§4） |
| `keyframes[0].t` が非有限値（NaN/Infinity） | crop 無視 + warning |
| `keyframes[0].t` が当該 cut の `[in, out]` 範囲外 | crop 無視 + warning（生成ミスとみなす） |
| `keyframes[0].box` の要素に非有限値を含む | crop 無視 + warning |
| `box` の `w <= 0` または `h <= 0` | crop 無視 + warning |
| `box` が `x < 0` / `y < 0` / `x + w > 1` / `y + h > 1`（素材フレームをはみ出す） | crop 無視 + warning |
| source の解像度が取得できない（0×0 等、通常到達しない） | crop 無視 + warning |
| 上記いずれにも該当しない場合 | 正規化座標をピクセルへ変換し `crop` フィルタを適用。
  丸め誤差・source 範囲外は実装内部でクランプする（境界の 1px 未満のズレでエラーにしない） |

いずれの劣化も「その cut だけ crop なしにする」に留め、他のカット・オーバーレイ・
音声・書き出し全体を巻き込んで失敗させない。`audio::resolve` の `warnings` と同じ
パターン（成果報告・stderr ログへの出力）で扱う。

## 7. データ設計意図

- **crop がカット単位（`cuts[]` の子）である理由**: keep-range を再構成する主体が
  `cuts` であり、リフレーミングは「その区間をどう見せるか」という cut に従属する
  属性だから。overlay や audio のようにタイムライン全体・特定時刻に紐づく独立要素とは
  性質が異なり、独立トップレベル配列にすると cut との対応関係を id 等で別管理する
  必要が生まれる。子フィールドにすることでその対応管理が不要になる
- **`box` が `faceBox` と同一形式（`[x, y, w, h]` 正規化座標）である理由**: `tracks.faces`
  からの生成（§3）でデータ変換を要らなくするため。契約をまたいでも「矩形の表現方法」
  という**形そのもの**を揃えることで、生成パイプラインの実装が「値をコピーするだけ」
  になり、変換ミスの入り込む余地を無くす（audio 契約 §6 の「スキーマの形で意図を語る」
  という設計原則の踏襲）

## 8. `analysis.schema.json` との整合確認

`schemas/analysis.schema.json` の `faceBox`（`prefixItems` 4 要素、各 0〜1、意味制約
`x+w<=1` かつ `y+h<=1`）と `faceTrackPoint`（`speaker`/`t`/`box`）を確認した。本契約の
`cuts[].crop.keyframes[].box` はこの `faceBox` の**値域・意味制約をそのまま踏襲**する
（配列の要素数・レンジを analysis 側と食い違わせない）。`speaker` フィールドは
`crop.keyframes` には持たせない: 生成フロー（§3）の時点で対象話者は確定しており、
edit.json 側（実行形）まで運ぶ必要がないため（audio 契約 §7 の
「実行形は承認結果の着地点」という位置づけと同じ判断）。

## 9. よくある間違い

- **`keyframes[].t` に timeline 秒（`audio.sfx[].t` や `overlays[].start` と同じ座標系）を
  渡す** — 誤り。crop の `t` は **source 秒**（`cuts[].in`/`out` と同じ）。audio 契約の
  慣習と逆になる点に注意（§2 に理由を明記）
- **複数 `keyframes` を渡せば自動的にパン（滑らかな動き）になると期待する** — v1 は
  先頭要素のみ採用する。線形補間ですら次段（§4）
- **`box` を対角 2 点 `[x1, y1, x2, y2]` だと誤解する** — 誤り。`[x, y, w, h]`
  （`faceBox` と同一。幅・高さであり終点座標ではない）
- **crop 矩形の生成元でジッター除去を省略する** — analysis 側（`tracks.faces` 生成）の
  責務（§3）。edit.json 側で平滑化のフォールバックは行わない。生の飛び値をそのまま
  渡すと（v1 は先頭点のみ使うため大事故にはならないが）次段の補間実装時に画面が
  ガタつく原因になる
- **`crop` の座標変換にピクセル値を直接書く** — 誤り。`box` は必ず 0〜1 の正規化座標。
  ピクセル変換は書き出し実装（`export/crop.rs`）の内部でのみ行う
- **プレビューで crop の見た目を最終判断する** — v1 のプレビューは crop を無視する
  （§5、TODO）。書き出し結果で確認すること

## 10. 型定義スケッチ（参考。非拘束・実装ラウンドで確定）

`src-tauri/src/video_plane/edit.rs` への追加を想定した草案。audio 契約 §9 と同じく、
本契約が拘束するのは §1 の JSON スキーマと §4〜6 の挙動であり、Rust の型そのものではない。

```rust
/// keep-range（cuts[]）内のリフレーミング（契約 §1）。省略時は crop なし
/// （従来どおり全画面 scale + letterbox/pillarbox）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crop {
    pub keyframes: Vec<CropKeyframe>,
}

/// crop の 1 点。`t` は source 秒（cuts[].in/out・tracks.faces[].t と同一座標系、§2）。
/// `box` は素材フレームに対する正規化座標 [x, y, w, h]（analysis.schema.json の
/// faceBox と同一形式、§7）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CropKeyframe {
    pub t: f64,
    #[serde(rename = "box")]
    pub r#box: [f64; 4],
}

// Cut への追加（既存フィールドは変更しない）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cut {
    #[serde(rename = "in")]
    pub r#in: f64,
    pub out: f64,
    #[serde(default)]
    pub crop: Option<Crop>,   // v1 追加
}
```

`Cut` は `crop: Option<Crop>`（`Vec` を含む）を持つため `Copy` を外し `Clone` のみにする
（v0 では `Copy` 付きだったが、フィールド追加に伴う機械的な変更であり挙動には影響しない）。

## 11. 次段（本契約のスコープ外）

- `keyframes` 複数点の**線形補間**実装（§4 で型には残したが v1 実装は先頭点のみ）
- プレビュー側（`AVMutableVideoComposition` の transform）実装（§5 TODO）
- `notes-2026-07-13-edit-json-v1.md` §3 の**レイアウト**（複数ソース矩形配置。対談の
  縦 2 段化など）
- `notes-2026-07-13-edit-json-v1.md` §1 の**出力プロファイル複数化**（ショート対応）

notes 記載の実装順（音声 → crop → 出力プロファイル → レイアウト）どおり、本契約の
確定後は出力プロファイルが次ラウンドの対象になる。
