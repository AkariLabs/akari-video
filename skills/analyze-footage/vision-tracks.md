# 顔ランドマーク・手ポーズのトラックを作る（任意工程）

## 目次

- [実行するかを先に決める](#実行するかを先に決める)
- [道具を確認する](#道具を確認する)
- [生成する](#生成する)
- [analysis.json への反映](#analysisjson-への反映)
- [劣化](#劣化)

## 原則

vision-tracks は**目線黒帯（eye-bar）・指フレーム（finger-frame）のような、瞳や指先の位置を
使う演出を使うと決めた素材でだけ**作る。既定の分析フローはトラックを作らず、
`tracks.face_landmarks` / `tracks.hand_pose` キー自体を書かない（未生成 = キー無し。
person_matte の「キーは必須・値が null」とは扱いが違う点に注意 — §2 参照）。データ契約は
[docs/contract-2026-08-11-analysis-vision-tracks-v0.md](../../docs/contract-2026-08-11-analysis-vision-tracks-v0.md)
が正本である。**分析はプル駆動**（契約 §0 原則 1）: 顔だけ要る演出なら `--kinds face` だけを
生成し、手のトラックは作らない。

## 実行するかを先に決める

全素材で常時実行しない。実測（26.3 秒 / 1280x720 / 24fps・`--kinds face,hand`・負荷のあるマシン）:

| 工程 | 実測 | 備考 |
|---|---|---|
| Vision 検出（顔+手 1 パス） | 13.5 ms/frame | 顔・手を同時要求しても 1 回の `perform()` で両方検出する |
| 全体（ffmpeg デコード込み） | 実時間比 **約 0.45 倍**（26.3 秒 → 11.9 秒） | エンコード段が無いため person-matte（約 7.7 倍）より大幅に軽い |

person-matte と違い **VP9 alpha エンコードが無い**（トラックは JSON であって動画ではない）ため、
実時間より速く終わる。それでも次のいずれにも当てはまらない素材では実行しない。

- 瞳・指先の位置を使う演出（eye-bar / finger-frame 等）を使うと決まっている。
- 顔だけ・手だけで足りる演出なら `--kinds face` または `--kinds hand` に絞る（両方要らないのに
  両方生成しない — プル駆動の原則）。

## 道具を確認する

```bash
node bin/vision-tracks/vision-tracks.mjs --check
```

`{"available":true}` 以外なら `reason` を報告し、トラックを作らずキー無しのまま進む。macOS、
`swiftc`、`ffmpeg`／`ffprobe` のいずれかが欠けていれば作れない（person-matte と違い
`libvpx-vp9` エンコーダは不要 — 動画を書き出さないため）。ネットワークからツールを導入しない。
Swift ヘルパーは初回実行時に `swiftc -O` で自動ビルドされ、バイナリはコミットしない
（[.gitignore](.gitignore) 参照）。

## 生成する

`--analysis` に**既存の（既に確定済みの）analysis.json** を渡す。person-matte と違い、
このツールは analysis.json を**自分で読み書きする**（agent が手で `tracks` へ貼り付ける
工程が無い）。

```bash
node bin/vision-tracks/vision-tracks.mjs \
  --input "$SOURCE" \
  --analysis "$OUT_DIR/analysis.json"
```

オプション（既定のままで良ければ渡さない）:

- `--kinds face,hand`（既定 `face,hand`）。`face` のみ・`hand` のみも指定できる。
  いずれの場合も ffmpeg デコード + Vision 検出は 1 回で済ませ、要求した種類のトラックファイルだけを書く
- `--fps <n>`（既定 24）。トラックのサンプリング fps。元素材と一致しなくてよい
- `--decode-width <n>`（既定 1280）。person-matte と同じ理由で、素材が 1280 幅未満なら
  拡大せずその幅を使う
- `--joint-confidence <0..1>`（既定 0.3）。手の各関節をこの信頼度未満で省略する
  （契約 §2.2「捏造ゼロ — 無い関節は無い」）。顔ランドマークには同種の閾値は無い
  （6 領域が丸ごと計算できない検出はそもそも出力に含めない — 後述）
- `--metrics <path>`。処理実測（frames・elapsed_seconds・realtime_ratio・detection_counts 等）を
  JSON で書く

`--input` には**原本**を渡す（person-matte と同じ理由 — プロキシでも動くが、原本と時刻対応が
崩れた素材を渡さない）。

成功時は 1 行の JSON が返る。`ok`、`tracks`（analysis.json へ書いた `face_landmarks` /
`hand_pose` ポインタ）、`frames`、`detection_counts`（kind ごとの総検出数）、
`elapsed_seconds`、`realtime_ratio` を含む。**analysis.json は自動的に書き換わっている**
（`.tmp` → 原子的置換）。

`ok: false` なら `reason` を報告し、トラックを諦めてキー無しのまま分析を続ける。**トラックが
作れないことを理由に分析全体を失敗扱いにしない。**

### 顔・手の一部だけ検出できないフレーム

- **手**: 各関節は `--joint-confidence` 未満だとキーごと省略される。全関節が省略されると、
  その手の検出は `joints: {}`（空 object）になる。これは検出はしたが信頼できる関節が
  無かったという事実であり、検出自体を消さない。
- **顔**: Vision が landmark 領域（瞳・目・唇）を一部でも計算できなかった顔は、
  その検出を**丸ごと**その時刻の `detections` から除く（v0 必須の 6 領域が揃わない検出を
  出力に混ぜない）。実測（26.3 秒・1 名の顔がほぼ映り続ける素材）ではこの除外は 0 件だった
  （report.md 参照）。逆光・強い横顔が続く素材では起こりうる。

### 座標系

出力される座標は**すべて 0〜1 正規化・左上原点**（契約 §2）。Vision framework 自体は
左下原点で返すため、y 反転はヘルパー内部で完結している。**エージェント側で座標を
反転・変換する必要はない。**

## analysis.json への反映

person-matte と異なり、agent が返り値を手で `tracks` へ貼り付ける工程は無い。
`vision-tracks.mjs` が analysis.json を直接読み、次を行ってから原子的に置き換える。

1. `<analysis-dir>/vision/face-landmarks.json` / `<analysis-dir>/vision/hand-pose.json`
   （要求した kind の分だけ）を書く。
2. `analysis.json` の `tracks.face_landmarks` / `tracks.hand_pose` に、そのファイルへの
   ポインタ（`path` は analysis.json のディレクトリ基準の相対パス・`sample_fps`・
   `provider`・`tool`・`generated_at`）を追記する。

```json
"face_landmarks": {
  "path": "vision/face-landmarks.json",
  "sample_fps": 24,
  "provider": "apple-vision",
  "tool": "vision-tracks.mjs v0",
  "generated_at": "2026-08-11T12:00:00Z"
}
```

**`--kinds face` だけで再実行すると、`hand_pose` の既存ポインタには触れない**（プル駆動 —
必要な種類だけを更新する。person-matte のような単一アーティファクトの上書きとは違う）。
すでに確定済みの analysis.json に対して実行する工程なので、[analysis-json.md](analysis-json.md)
の Schema 検証・意味制約チェックを**先に**通してから呼び出すこと。

## 劣化

道具が無い、生成に失敗した場合は `tracks.face_landmarks` / `tracks.hand_pose` の**キー自体を
書かず**に分析を確定し、理由を完了報告に書く（person_matte の「キーは必須・値は null」という
劣化表現とは違う — このトラックは真に任意であり、キーの有無で生成済みかどうかを表す）。

## よくある間違い

- 瞳・指先の位置を使う演出を使うと決まっていない素材にも一律で実行する。
- `--kinds face,hand` を毎回指定し、顔だけで足りる演出でも手のトラックまで生成する。
- 出力された座標を「Vision は左下原点だから」と agent 側でもう一度反転する
  （ヘルパーが既に反転済み — 二重反転すると壊れる）。
- 手の関節が `joints: {}`（空）の検出を「検出失敗」と誤読してエラーにする（信頼できる
  関節が無かっただけで、手自体の検出は成立している）。
- `analysis.json` を Schema 検証する前に vision-tracks.mjs を実行し、壊れた analysis.json に
  対してトラックだけ足してしまう。
- トラックが作れなかったことを理由に `analysis.json` 自体を出さない。
