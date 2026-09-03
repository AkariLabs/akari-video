# 人物マットを作る（任意工程）

## 目次

- [実行するかを先に決める](#実行するかを先に決める)
- [道具を確認する](#道具を確認する)
- [生成する](#生成する)
- [カットへ自動配線する](#カットへ自動配線する)
- [analysis.json へ書く](#analysisjson-へ書く)
- [グレースケールマスクを使う](#グレースケールマスクを使う)
- [Windows 実機検証手順](#windows-実機検証手順)
- [劣化](#劣化)

## 原則

人物マットは**人物演出（text-behind-person など）を使うと決めた素材でだけ**作る。既定の分析
フローはマットを作らず `tracks.person_matte` に `null` を書く。データ契約は
[docs/contract-2026-07-23-analysis-person-matte.md](../../docs/contract-2026-07-23-analysis-person-matte.md) が正本である。
以下の `$PERSON_MATTE_BIN/...` は L3 サイドカー生成器の公開インターフェースであり、媒体バックエンドを
analyze-footage の手順から直接呼ぶものではない。内部のデコード・検証は生成器自身が担う。

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

Windows では全品質段が RVM mobilenetv3 になる。手順は [Windows 実機検証手順](#windows-実機検証手順) を参照する。

`fast` の出力を本番の成果物として `analysis.json` に載せない。

## 道具を確認する

```bash
PERSON_MATTE_BIN=".claude/skills/analyze-footage/bin/person-matte"
[ -d "$PERSON_MATTE_BIN" ] || PERSON_MATTE_BIN="skills/analyze-footage/bin/person-matte"
node "$PERSON_MATTE_BIN/person-matte.mjs" --check
```

`available:true` 以外なら `reason` を報告し、マットを作らずに `null` のまま進む。結果には既定の
RVM モデルの配備状況を示す `rvm_model` も含まれる。Mac は `swiftc`、同梱メディア道具、VP9 alpha
エンコーダを要求する。Windows は swiftc を要求せず、同じメディア道具に加えて RVM の
mobilenetv3 モデルを要求する。メディア道具の探索はサイドカー生成器内部の解決規則に委ねる。
ネットワークからツールを導入しない。Mac の Swift ヘルパーは初回実行時に `swiftc -O` で自動ビルドされ、
バイナリはコミットしない（[.gitignore](.gitignore) 参照）。

## 生成する

出力は analysis.json と同じディレクトリの `matte/person-matte.webm` に置く。

```bash
node "$PERSON_MATTE_BIN/person-matte.mjs" \
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
`alpha_transparent_ratio`（完全透明画素の割合）、`probe`（同梱 prober の実測）を含む。
ヘルパーは書き出した WebM が `codec_name = vp9` かつ `alpha_mode = 1` であることを確認してから
成功を返すので、`ok: true` はアルファが落ちていないことを含意する。

`ok: false` なら `reason` を報告し、マットを諦めて `null` のまま分析を続ける。**マットが作れない
ことを理由に分析全体を失敗扱いにしない。**

## カットへ自動配線する

使い分けは次のとおり。

- 素材全体の解析結果として `analysis.json` の `tracks.person_matte` を作る場合は、上の
  `person-matte.mjs` を使う。入力素材の時刻 0 とマットの時刻 0 を一致させる。
- 編集済みの特定カットを人物レイヤーへ載せる場合は `person-cutout.mjs` を使う。カットの `in` /
  `out` / `speed` を解決し、速度適用済みの区間マットを作って v2 `edit.json` へ自動配線する。

```bash
node "$PERSON_MATTE_BIN/person-cutout.mjs" \
  --project /path/to/project \
  --cut 0
```

`--cut` は v2 `tracks` を下から上、各 `items` を宣言順に走査した visual media item の 0 始まり
index で、`0,2,4` のように複数指定できる。自動生成済みの `person-N` item は数えない。
`--quality fast|balanced|accurate|best`（既定 `balanced`）と、`best` の場合だけ
`--model mobilenetv3|resnet50` を指定できる。

生成物は `<project>/assets/matte/person-<cut index>.webm`。v2 は旧 `layers[]` と
`timeline.tracks` を持たず、トップレベル `tracks[]` 自体が下→上の z 順の正本なので、コマンドは
マットを `sources[]` に登録し、対応する media item を `person-cutout` visual track へ置く。この
track は既存 track の相互順を変えず最前面へ移すため、HTML overlay やテロップより人物が上に来る。

同じ cut へ再実行すると `person-cutout-N` source と `person-N` item を更新し、source / item / track
を重複させない。`edit.json` は候補ファイルを v2 reader と `validate-edit.mjs` の両方で検証してから
atomic rename し、不合格時は元ファイルを変更しない。

変更内容だけを確認する場合は `--dry-run` を付ける。マットの生成、ディレクトリ作成、edit.json の
書き換えを一切行わず、予定するマット・レイヤー互換表示・track 順を stdout の 1 行 JSON で返す。

```bash
node "$PERSON_MATTE_BIN/person-cutout.mjs" \
  --project /path/to/project \
  --cut 1,3 \
  --quality best \
  --model resnet50 \
  --dry-run
```

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

## グレースケールマスクを使う

`person-matte.mjs` は VP9 alpha WebM を従来どおり生成しながら、同じ推論結果の raw BGRA から
`<basename>.mask.mp4` も併産する。成功結果の `person_matte` には `mask_path` と
`mask_format: "gray-h264-fullrange"` が加わる。マスク生成だけが失敗した場合も VP9 alpha WebM は
成功扱いのままで、結果の `mask.reason` に劣化理由が入る。

既存の VP9 alpha WebM しかない場合は、次の冪等コマンドで一度だけ変換する。入力より新しい出力が
あれば skip し、作り直す場合だけ `--force` を付ける。

```bash
node "$PERSON_MATTE_BIN/mask-from-alpha.mjs" \
  --input "$OUT_DIR/matte/person-matte.webm"
```

往復精度は次のコマンドで全フレーム比較できる。

```bash
node "$PERSON_MATTE_BIN/mask-roundtrip.mjs" --alpha <webm> --mask <mp4>
```

合否閾値は
alpha WebM を真値とみなす取り込み変換の基準である。併産された兄弟 2 形式の比較では、それぞれの
符号化損失の和を測るため、この閾値で `ok:false` になっても変換精度の不合格を意味しない。

## Windows 実機検証手順

Windows では `fast` / `balanced` / `accurate` / `best` の全段が RVM mobilenetv3 を使う。
次の PowerShell コマンドは公開リポジトリのルートで実行する。Node.js 20 以上を前提とし、まず版を確認して
`packages/matte-rvm` 内で依存と既定モデルを明示的に配備する。

```powershell
node --version
cd packages\matte-rvm
npm install
npm run fetch:models
cd ..\..
$PersonMatteBin = if (Test-Path ".claude\skills\analyze-footage\bin\person-matte") { ".claude\skills\analyze-footage\bin\person-matte" } else { "skills\analyze-footage\bin\person-matte" }
```

道具とモデルを検査する。

```powershell
node "$PersonMatteBin\person-matte.mjs" --check
```

期待する 1 行 JSON は次の形で、`available` が `true`、`rvm_model.missing` が `false` になる。

```json
{"available":true,"rvm_model":{"model":"mobilenetv3","path":"C:\\...\\rvm_mobilenetv3_fp32.onnx","missing":false,"fetchHint":"cd packages/matte-rvm && node scripts/fetch-models.mjs"}}
```

次に、人物が映る実素材 1 本を `C:\Users\owner\Videos\person-input.mp4` へ置き、`balanced` で生成する。
出力先は必要に応じて書き換える。

```powershell
$SOURCE = "C:\Users\owner\Videos\person-input.mp4"
$OUT = "C:\Users\owner\Videos\person-matte-balanced.webm"
node "$PersonMatteBin\person-matte.mjs" --input "$SOURCE" --out "$OUT" --quality balanced
```

実際に返る 1 行 JSON から確認するキーの抜粋は次のとおりで、`ok:true`、`engine:"rvm"`、`model:"mobilenetv3"`、
`probe.alpha_mode:"1"` を含む。`quality` は `person_matte.quality:"balanced"` として指定値のまま残る。

```json
{"ok":true,"engine":"rvm","model":"mobilenetv3","person_matte":{"path":"C:\\Users\\owner\\Videos\\person-matte-balanced.webm","fps":24,"quality":"balanced","tool":"rvm-person-matting"},"probe":{"codec_name":"vp9","alpha_mode":"1"}}
```

速度は `rvm_ms_per_frame`（RVM 推論 1 フレーム当たりのミリ秒）で読む。Mac の既存実測は
**137〜271 ms/frame** なので、Windows の値を同じ単位で比較する。VP9 エンコードを含む全体時間では
ないため、総所要時間は `elapsed_seconds` も併記する。

実測記録欄:

- Windows PC: CPU ______ / RAM ______ GB / GPU ______ / Windows ______
- 素材: 解像度 ______ / fps ______ / 尺 ______ 秒
- `rvm_ms_per_frame`: ______ ms/frame（Mac 137〜271 ms/frame と比較）
- `elapsed_seconds`: ______ 秒

つまずいた場合は `reason` を先に読む。

- モデル不在: `rvm_model.missing:true` または reason 内の `fetchHint` を確認し、次のコマンドで
  mobilenetv3 を取得してから再検査する。

  ```powershell
  cd packages\matte-rvm
  node scripts\fetch-models.mjs
  cd ..\..
  node "$PersonMatteBin\person-matte.mjs" --check
  ```

- 同梱メディア道具不在: `packages/media-bin` の postinstall が同梱バイナリを配備するため、
  次のコマンドで配備をやり直してから `--check` を再実行する。

  ```powershell
  cd packages\media-bin
  npm install
  cd ..\..
  node "$PersonMatteBin\person-matte.mjs" --check
  ```

- `libvpx-vp9` 不在: 解決された encoder が VP9 alpha を書けない。`reason` に従って media-bin の配備と
  解決元を確認する。

## 劣化

道具が無い、生成に失敗した、または品質が実用に達しない場合は `tracks.person_matte` を `null` に
して分析を確定し、理由を完了報告に書く。未生成を空文字や欠落したパスで表さない。

細い毛束を 1 本単位で分離することは Vision ではできない（セグメンテーションであってマット化では
ない）。逆光・毛先の抜けが要求水準になる素材では、マットが取れても品質不足として `null` を選ぶ
判断があり得る。その判断も完了報告に書く。

## よくある間違い

- 人物演出を使うと決まっていない素材にも一律で実行し、分析時間を何倍にもする。
- `fast` の出力を本番の切り抜きとして確定する。
- 出来上がったマット動画を別の媒体変換コマンドで再エンコードする（アルファが無言で落ちる）。
- マットを素材の途中区間から切り出し、時刻 0 の一致を壊す。
- `--fps` を変えたのに `analysis.json` の `fps` を書き換え忘れる。
- ヘルパーが返した絶対パスをそのまま `path` に書く。
- マットが作れなかったことを理由に `analysis.json` 自体を出さない。
