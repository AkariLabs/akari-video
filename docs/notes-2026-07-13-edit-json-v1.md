# edit.json v1 拡張メモ

- 日付: 2026-07-13
- 状態: 方向性メモ（v0 は `contract-2026-07-13-m1-m4.md` で確定・実装済み。
  v1 は M5 の要求が固まった時点で契約に昇格させる）
  （追記 2026-07-14: §5 音声は contract-2026-07-14-edit-json-v1-audio.md へ昇格）
- 原則: `version` フィールドで段階進化。v0 の後方互換を壊さない

## v1 で入れる候補

### 1. 出力プロファイル複数化（ショート対応）

```jsonc
"outputs": [
  { "id": "master", "width": 1920, "height": 1080, "fps": 30 },
  { "id": "short",  "width": 1080, "height": 1920, "fps": 30, "duration_max": 60 }
]
```

1 つの分析・素材計画から 16:9 マスターと 9:16 ショートを両方出す。
ショート側はフック候補（analysis.json の events.hook）から半自動生成。

### 2. カット単位の crop（リフレーミング）

```jsonc
"cuts": [
  { "in": 5.0, "out": 10.0,
    "crop": { "keyframes": [ { "t": 0.0, "box": [0.2, 0.0, 0.56, 1.0] } ] } }  // 正規化座標
]
```

- 顔/人物トラック（analysis.json の tracks.faces）から生成、平滑化済みの軌跡を持つ
- プレビュー = AVFoundation video composition の transform / 書き出し = ffmpeg crop。
  サンドイッチ構造は不変
- 対談横長 → 縦 2 段のような複数矩形は「レイアウト」（下記）で扱う

### 3. レイアウト（複数ソース矩形配置）

```jsonc
"layout": { "regions": [
  { "source_crop": [0.0, 0.1, 0.5, 0.8], "dest": [0.0, 0.0, 1.0, 0.5] },   // 話者 A → 上段
  { "source_crop": [0.5, 0.1, 0.5, 0.8], "dest": [0.0, 0.5, 1.0, 0.5] }    // 話者 B → 下段
] }
```

対談の縦長化などの定番。レポートで配置モック画像を提示 → 承認 → 反映のフロー。

### 4. 断片内 `<video>` の時刻同期（text-behind-person 等）

- M2 ランタイムの tick に「`data-akari-sync` の付いた `<video>` 要素の currentTime を
  タイムラインへ同期」を追加（現状はアニメーションのみ同期）
- 用途: 人物切り抜きアルファ動画（HEVC alpha）を DOM 最前面に重ね、テキストを
  人物の後ろに入れる表現。スキーマ変更は不要（HTML 断片内で完結）だが
  ランタイム拡張が要るためここに記録

### 5. 音声スキーマ（素材計画の実行形）

```jsonc
"audio": {
  "bgm": { "path": "assets/bgm.m4a", "gain_db": -18, "ducking": true },   // 全体トラック
  "sfx": [ { "path": "assets/pop.m4a", "t": 12.3, "gain_db": -6 } ]        // シーン単位
}
```

「BGM は全体 / SFX はシーン単位」を**スキーマとして明示**する（説明可能性 =
なぜこの素材がここにあるかをデータが語れるようにする）。

### 6. サムネイル確定枠

```jsonc
"thumbnail": { "path": "thumbnail.png", "source": "report:candidate-2" }
```

レポートで承認された案を確定保存。provenance としてどの候補由来かを持つ。

## 実装順の目安

音声（5）→ crop（2）→ 出力プロファイル（1）→ レイアウト（3）の順が依存関係として自然。
（4）はスキーマ非依存なので M2 ランタイムの改修としていつでも入れられる。
