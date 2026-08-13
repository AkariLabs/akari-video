# Region filter layer v0

## 1. 背景

finger-frame の中心表現を、別映像の corner-pin 合成だけでなく、指で作った枠の内側だけベース映像自身のルックを切り替える表現へ拡張する。この用途では貼り込み素材を入力せず、ベース映像からフィルター済みの映像を作り、指定 region の内側だけへ戻す。

本書は `edit.json` の additive な拡張である `layers[].kind: "filter"` の v0 契約を定める。

## 2. 意味論

- `kind: "filter"` の layer は `src` を持たない。ベース映像以外の貼り込み入力を追加しない。
- `filter` は region の内側にだけ適用し、region の外側はベース映像をそのまま保つ。
- layer の発動時間窓は既存どおり `t` と `duration` で表す。
- `opacity`、`track`、および `keyframes[].perspective` は既存 layer の共通フィールドを再利用する。
- `src`、`chroma_key`、`blend`、`crop`、`transform` は `kind: "filter"` では使用できない。

## 3. Region source v0

v0 の region source は `perspective.corners` の quad である。表現、4 隅の順序、値域、退化四角形の制約は既存の `layerPerspective` をそのまま再利用する。`keyframes[].perspective` がある場合は既存の perspective keyframe 展開規約に従い、時間区間ごとの静的 quad として合成する。

## 4. 凍結インターフェース

```jsonc
{
  "id": "finger-frame-1",
  "kind": "filter",
  "t": 12.0,
  "duration": 2.4,
  "filter": { "type": "invert" },
  // または { "type": "lut", "id": "<presets/luts の id>", "intensity": 1.0 }
  // または { "type": "saturation", "value": 1.6 }
  "perspective": { "corners": [[0, 0], [1, 0], [0, 1], [1, 1]] },
  "keyframes": [
    {
      "t": 0.1,
      "perspective": { "corners": [[0, 0], [1, 0], [0, 1], [1, 1]] }
    }
  ],
  "opacity": 1.0
}
```

`filter` は次の closed union とする。

```jsonc
{
  "type": "object",
  "required": ["type"],
  "oneOf": [
    {
      "properties": { "type": { "const": "invert" } },
      "required": ["type"],
      "additionalProperties": false
    },
    {
      "properties": {
        "type": { "const": "lut" },
        "id": { "type": "string", "minLength": 1, "pattern": "\\S" },
        "intensity": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["type", "id"],
      "additionalProperties": false
    },
    {
      "properties": {
        "type": { "const": "saturation" },
        "value": { "type": "number", "minimum": 0, "maximum": 3 }
      },
      "required": ["type", "value"],
      "additionalProperties": false
    }
  ]
}
```

LUT の `intensity` 省略時は `1` として描画する。

## 5. 予約（今回のスコープ外）

- region source `mask`: ピクセル単位のマットを region として使用する予約。v0 では schema、CLI、renderer のいずれにも実装しない。
- filter type `"pixelate"`: face-mosaic の将来の移行先として予約する。v0 の closed union には含めず、指定された場合は拒否する。

予約名は現在利用可能であることを意味しない。

## 6. Additive 原則

この契約は既存の `kind: "baked"` / `kind: "video"` に対する additive な拡張である。既存 kind の必須フィールド、合成順、フィルターチェーン、examples / fixtures の妥当性と出力は変更しない。filter layer を含まない既存入力は従来とバイト等価に扱う。

## 7. 実装対応

- `packages/render-cut/src/filter-mask.mjs` / `layers.mjs`: corner keyframes からフレーム単位の縮小 gray8 quad mask を生成し、ベース映像の split、ルック適用、拡大したマスクとの `maskedmerge` による region 内合成を行う。filter layer ごとにマスク動画用の `-i` を 1 本追加する。
- `packages/akari-tools/bin/finger-frame.mjs`: `--kind filter --filter invert|lut:<id>|saturation:<value>` から、既存と同じ gesture window と corner keyframes を持つ layer を生成する。

## 8. 検証

L0 では schemas、akari-tools、render-cut の各 `node --test`、docs-sync、既存 baked / video の非回帰を確認する。ffmpeg コマンド生成テストは filter layer が追加 `-i` を作らず、3 種の filter と perspective keyframe 展開が決定論的なグラフを生成することを確認する。

12 秒 window の実素材による invert / LUT の見た目、所要時間、入力数の実測は別途実施し、検証報告へ記録する。
