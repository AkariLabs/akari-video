# 人物マットを作る（任意工程）

## 目次

- [実行するかを先に決める](#実行するかを先に決める)
- [道具を確認する](#道具を確認する)
- [生成する](#生成する)
- [analysis.json へ書く](#analysisjson-へ書く)
- [劣化](#劣化)

## 原則

人物マットは**人物演出（text-behind-person など）を使うと決めた素材でだけ**作る。既定の分析
フローはマットを作らず `tracks.person_matte` に `null` を書く。データ契約は
[docs/contract-2026-07-23-analysis-person-matte.md](../../docs/contract-2026-07-23-analysis-person-matte.md) が正本である。

## 実行するかを先に決める

全素材で常時実行しない。実測コスト（8 秒 / 1280x720 / 24fps / `balanced`・負荷のあるマシン）:

| 工程 | 実時間比 | 備考 |
|---|---|---|
| Vision セグメンテーション | 約 1.7 倍 | 58 ms/frame。マットは 512x384 固定 |
| VP9 alpha エンコード | 残り全部 | **壁時計時間の支配項** |
| 合計 | **約 7.7 倍**（8 秒 → 62 秒） | 10 分素材なら 1 時間強の目安 |

次のすべてに当てはまるときだけ実行する。

- その素材に人物が映っており、人物を切り抜く演出を使うと決まっている。
- 素材の尺と上の実時間比から見積もった処理時間を許容できる。
- 単に「顔が映っている」だけではない（顔トラック `tracks.faces` はマット無しで作れる）。

品質の選び方:

| quality | 用途 | 実測 |
|---|---|---|
| `fast` | 当たり付け・「この素材で切り抜けるか」の事前判定のみ | マット 256x192。輪郭が階段状で**本番不可** |
| `balanced`（既定） | **本番**（text-behind-person / 切り抜き） | マット 512x384・58 ms/frame・実用輪郭 |
| `accurate` | 寄りカット・最終仕上げ | マット 2016x1512・135 ms/frame・peak 638 MB |
| `best` | **髪の毛をくっきり残す必要があるときだけ** | RVM mobilenetv3。10 秒素材で約 1〜1.5 分待つ目安 |
| `best --model resnet50` | 処理時間をさらに許容できる場合のこだわり指定 | RVM resnet50。既定の mobilenetv3 より大幅に遅い |

`fast` の出力を本番の成果物として `analysis.json` に載せない。

## 道具を確認する

```bash
node bin/person-matte/person-matte.mjs --check
```

`available:true` 以外なら `reason` を報告し、マットを作らずに `null` のまま進む。結果には既定の
RVM モデルの配備状況を示す `rvm_model` も含まれる。macOS、
`swiftc`、`ffmpeg`／`ffprobe`、ffmpeg の `libvpx-vp9` エンコーダのいずれかが欠けていれば作れない。
ネットワークからツールを導入しない。Swift ヘルパーは初回実行時に `swiftc -O` で自動ビルドされ、
バイナリはコミットしない（[.gitignore](.gitignore) 参照）。

## 生成する

出力は analysis.json と同じディレクトリの `matte/person-matte.webm` に置く。

```bash
node bin/person-matte/person-matte.mjs \
  --input "$SOURCE" \
  --out "$OUT_DIR/matte/person-matte.webm"
```

オプション（既定のままで良ければ渡さない）:

- `--quality fast|balanced|accurate|best`（既定 `balanced`）
- `--model mobilenetv3|resnet50`（`--quality best` のときだけ指定可、既定 `mobilenetv3`）。
  `resnet50` は `cd packages/matte-rvm && node scripts/fetch-models.mjs --model resnet50` で明示取得する
- `--fps <n>`（既定 24）。マット動画の fps。元素材と一致しなくてよい
- `--decode-width <n>`（既定 1280）。Vision のマット解像度は quality だけで決まり入力解像度に
  依存しないため、通常は変更しない。素材が 1280 幅未満なら拡大せずその幅を使う

`--input` には**原本**を渡す。プロキシ（`proxy.mp4`）を渡してもよいが、その場合マットの RGB は
720p の絵になる。原本と時刻対応が崩れた素材を入力にしない。

成功時は 1 行の JSON が返る。`ok`、`frames`、`bytes`、`elapsed_seconds`、`engine`、
Vision 時の `vision_ms_per_frame` または RVM 時の `rvm_ms_per_frame`、
`alpha_transparent_ratio`（完全透明画素の割合）、`probe`（ffprobe の実測）を含む。
ヘルパーは書き出した WebM が `codec_name = vp9` かつ `alpha_mode = 1` であることを確認してから
成功を返すので、`ok: true` はアルファが落ちていないことを含意する。

`ok: false` なら `reason` を報告し、マットを諦めて `null` のまま分析を続ける。**マットが作れない
ことを理由に分析全体を失敗扱いにしない。**

## analysis.json へ書く

返ってきた JSON の `person_matte` をそのまま使えるが、**`path` は analysis.json のディレクトリ
基準の相対パスへ書き換える**（ヘルパーは呼び出し時の絶対パスを返す）。区切りは `/` を使う。

```json
"person_matte": {
  "path": "matte/person-matte.webm",
  "fps": 24,
  "quality": "balanced",
  "generated_at": "2026-07-23T01:33:30.069Z",
  "tool": "vision-person-segmentation"
}
```

`path` と `fps` が必須、`quality` / `generated_at` / `tool` は任意である。
確定前に [analysis-json.md](analysis-json.md#schema-では表せない意味制約) の意味制約も検査する。

- マット動画の時刻 0 が素材の時刻 0 と一致する（区間を切り出したマットを載せない）。
- `fps` が実際に書き出したマット動画の fps と一致する。
- `path` を analysis.json の位置から解決でき、実ファイルが存在する。

## 劣化

道具が無い、生成に失敗した、または品質が実用に達しない場合は `tracks.person_matte` を `null` に
して分析を確定し、理由を完了報告に書く。未生成を空文字や欠落したパスで表さない。

細い毛束を 1 本単位で分離することは Vision ではできない（セグメンテーションであってマット化では
ない）。逆光・毛先の抜けが要求水準になる素材では、マットが取れても品質不足として `null` を選ぶ
判断があり得る。その判断も完了報告に書く。

## よくある間違い

- 人物演出を使うと決まっていない素材にも一律で実行し、分析時間を何倍にもする。
- `fast` の出力を本番の切り抜きとして確定する。
- 出来上がったマット動画を ffmpeg で再エンコード・再変換する（アルファが無言で落ちる）。
- マットを素材の途中区間から切り出し、時刻 0 の一致を壊す。
- `--fps` を変えたのに `analysis.json` の `fps` を書き換え忘れる。
- ヘルパーが返した絶対パスをそのまま `path` に書く。
- マットが作れなかったことを理由に `analysis.json` 自体を出さない。
