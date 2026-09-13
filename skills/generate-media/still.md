# 静止画で仮枠を作る

仮枠は edit.json v2 のタイムライン上に置く静止画 media item と、その素材の隣の `<path>.meta.json` の組である。尺は item の cuts が持つ。動画化しないまま完成品として残してもよい。

## beats.json

構成の各ビートを、順序・ラベル・静止画 prompt・目標尺・出力名へ落とす。最小構成の例:

```json
{
  "version": 1,
  "beats": [
    {
      "item_id": "item-opening",
      "label": "オープニング",
      "prompt": "朝の窓辺に置かれたノート、柔らかな自然光、16:9、文字なし",
      "duration_s": 4,
      "output": "opening.png"
    },
    {
      "item_id": "item-demo",
      "label": "操作デモ",
      "prompt": "動画編集タイムラインを操作する手元、落ち着いた青系、16:9、文字なし",
      "duration_s": 8,
      "output": "demo.png"
    },
    {
      "item_id": "item-ending",
      "label": "エンディング",
      "prompt": "夕暮れのデスクと閉じたノート、余韻のある構図、16:9、文字なし",
      "duration_s": 3,
      "output": "ending.png"
    }
  ]
}
```

- `version`: beats.json の形式バージョン
- `beats`: タイムライン順の仮枠定義。配列順は持つが、開始秒は持たない
- `item_id`: 対応する edit.json v2 の item id。各 beat と 1:1 で結ぶ
- `label`: 人間が識別するビート名
- `prompt`: 文字カードではなく静止画を生成するときの画面内容
- `duration_s`: 仮枠の秒数。対応 item の cuts の尺と一致させる
- `output`: `assets/generated/` 配下へ保存するファイル名

開始秒を beats.json と edit.json の両方に持たせない。位置はタイムラインから決まり、尺は cuts と一致させる。CLI が受理する正確なスキーマは `akari generate still --help` / `--dry-run --json` で確認する。

まず送信内容と変更予定だけを見る場合:

```sh
akari generate still <projectDir> --spec <beats.json> --dry-run --json
```

静止画を作る場合:

```sh
akari generate still <projectDir> --spec <beats.json> --parallel N --json
```

## 文字カード

絵が未決、生成接続が無い、または尺と並びだけを先に確認したい場合は `--placeholder` を使う。

```sh
akari generate still <projectDir> --spec <beats.json> --placeholder --json
```

文字カード png は無料でその場に作られ、隣の meta は `kind: "still"`、`status: "planned"` になる。動画モデルへは送らない。後で静止画や動画へ差し替えられるが、文字カードのまま書き出すこともできる。

## meta の確認

生成物と `<file>.meta.json` がともに `assets/generated/` にあり、次を満たすことを確認する。

- `kind` が `still`、状態が文字カードなら `planned`、生成済みなら `done`
- `inputs` に prompt と参照画像、`output` に要求した出力条件が残る
- `result.path`、sha256、寸法、作成時刻、使用した手を provenance から追える
- edit.json の item id・トラック・尺は保たれ、生成専用フィールドが追加されていない

仮枠は「未完成」の印ではない。静止画として意図どおりなら、そのまま最終成果物として扱う。
