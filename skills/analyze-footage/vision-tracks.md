# 顔ランドマーク・手ポーズ・3D ボディポーズのトラックを作る（任意工程）

## 目次

- [実行するかを先に決める](#実行するかを先に決める)
- [道具を確認する](#道具を確認する)
- [生成する](#生成する)
- [analysis.json への反映](#analysisjson-への反映)
- [body-pose-3d（3D ボディポーズ）](#body-pose-3d3d-ボディポーズ)
- [消費: 目線黒帯（eye-bar）](#消費-目線黒帯eye-bar)
- [消費: pose-skeleton](#消費-pose-skeleton)
- [劣化](#劣化)
- [消費側: finger-frame（指フレーム切り替え）](#消費側-finger-frame指フレーム切り替え)

## 原則

vision-tracks は**目線黒帯（eye-bar）・指フレーム（finger-frame）・スティックフィギュア
（pose-skeleton）のような、瞳・指先・身体の関節位置を使う演出を使うと決めた素材でだけ**作る。
既定の分析フローはトラックを作らず、`tracks.face_landmarks` / `tracks.hand_pose` /
`tracks.body_pose_3d` キー自体を書かない（未生成 = キー無し。
person_matte の「キーは必須・値が null」とは扱いが違う点に注意 — §2 参照）。データ契約は
[docs/contract-2026-08-11-analysis-vision-tracks-v0.md](../../docs/contract-2026-08-11-analysis-vision-tracks-v0.md)
が正本である。**分析はプル駆動**（契約 §0 原則 1）: 顔だけ要る演出なら `--kinds face` だけを
生成し、手や 3D ボディポーズのトラックは作らない。

## 実行するかを先に決める

全素材で常時実行しない。実測（26.3 秒 / 1280x720 / 24fps・`--kinds face,hand`・負荷のあるマシン）:

| 工程 | 実測 | 備考 |
|---|---|---|
| Vision 検出（顔+手 1 パス） | 13.5 ms/frame | 顔・手を同時要求しても 1 回の `perform()` で両方検出する |
| 全体（ffmpeg デコード込み） | 実時間比 **約 0.45 倍**（26.3 秒 → 11.9 秒） | エンコード段が無いため person-matte（約 7.7 倍）より大幅に軽い |

person-matte と違い **VP9 alpha エンコードが無い**（トラックは JSON であって動画ではない）ため、
実時間より速く終わる。それでも次のいずれにも当てはまらない素材では実行しない。

**性能の注意（重要）**: 実測 15.3 倍実時間（12 秒素材で約 3 分）。face/hand の実時間比
（約 0.45 倍）と桁違いに重いので、プル駆動の原則（契約 §0 原則 1）どおり、body-pose-3d を
使う演出（pose-skeleton 等）を使うと決めた区間だけに絞ること。長尺素材では `--fps` を下げ、
サンプリング頻度を落とす選択肢がある。

- 瞳・指先・身体の関節位置を使う演出（eye-bar / finger-frame / pose-skeleton 等）を使うと
  決まっている。
- 顔だけ・手だけ・3D ボディポーズだけで足りる演出なら `--kinds face` / `--kinds hand` /
  `--kinds body-pose-3d` に絞る（不要な種類まで生成しない — プル駆動の原則）。

## 道具を確認する

```bash
node bin/vision-tracks/vision-tracks.mjs --check
```

`{"available":true}` 以外なら `reason` を報告し、トラックを作らずキー無しのまま進む。macOS、
`swiftc`、`ffmpeg`／`ffprobe` のいずれかが欠けていれば作れない（person-matte と違い
`libvpx-vp9` エンコーダは不要 — 動画を書き出さないため）。ネットワークからツールを導入しない。
`--check` も指定された `--kinds` だけを検査し、macOS 14 未満では `body-pose-3d` のみ利用不可
（`face` / `hand` には影響しない）。
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

- `--kinds face,hand`（既定 `face,hand`）。`face` / `hand` / `body-pose-3d` をカンマ区切りで
  自由に組み合わせられ、`--kinds body-pose-3d` のように 1 種類だけでも指定できる。
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
`hand_pose` / `body_pose_3d` ポインタ）、`frames`、`detection_counts`（kind ごとの総検出数）、
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

顔・手の座標と body-pose-3d の `projection` は**すべて 0〜1 正規化・左上原点**
（契約 §2）。Vision framework 自体は左下原点で返すため、y 反転はヘルパー内部で完結している。
body-pose-3d の `position` は root/hip 相対メートルのモデル座標である。いずれも
**エージェント側で座標を反転・変換する必要はない。**

## analysis.json への反映

person-matte と異なり、agent が返り値を手で `tracks` へ貼り付ける工程は無い。
`vision-tracks.mjs` が analysis.json を直接読み、次を行ってから原子的に置き換える。

1. `<analysis-dir>/vision/face-landmarks.json` / `<analysis-dir>/vision/hand-pose.json` /
   `<analysis-dir>/vision/body-pose-3d.json`
   （要求した kind の分だけ）を書く。
2. `analysis.json` の `tracks.face_landmarks` / `tracks.hand_pose` / `tracks.body_pose_3d` に、そのファイルへの
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

## body-pose-3d（3D ボディポーズ）

body-pose-3d だけを生成する場合は、確定済みの analysis.json に対して次を実行する。

```bash
node bin/vision-tracks/vision-tracks.mjs --input <video> --analysis <analysis.json> --kinds body-pose-3d
```

出力は macOS 14+ 限定の `VNDetectHumanBodyPose3DRequest` revision 1 が返す 17 関節で、
各関節に root/hip 相対メートルの `position` と 2D の `projection` を保存する。17 関節のうち
1 関節でも取得できない観測は detection ごと省略する「全か無か」のトラックであり、部分検出や
補間による捏造は行わない（契約 §2.4「捏造ゼロ」）。v0 の各関節の `conf` は関節別の値ではなく、
`VNHumanBodyPose3DObservation.confidence` という観測全体の confidence を複製した値である。

## 消費: 目線黒帯（eye-bar）

`face_landmarks` を生成しただけでは何も起きない。「犯罪者風の目線黒帯」を実際に映像へ乗せる
のは別の決定論変換器 `packages/akari-tools/bin/eye-bar.mjs`（`akari internal eye-bar` からも
起動できる）の仕事であり、本スキルの範囲外（[analysis-vision-tracks-v0 契約](../../docs/contract-2026-08-11-analysis-vision-tracks-v0.md)
§4）。使い分け:

- **本スキル（vision-tracks.mjs）**: 「動画から瞳の位置を検出してトラックに残す」——
  分析（事実の記録）
- **eye-bar.mjs**: 「トラックから黒帯の位置・角度・大きさを計算し `layers[].keyframes`
  として `edit.json` に足す」—— 消費（演出への変換）

顔だけ・瞳を使う演出（eye-bar）を使うと決めているときは、`--kinds face`（`hand` は不要）で
トラックを作ってから、承認済みの `edit.json`（cuts が確定済みであること — eye-bar は
cuts の in/out/at/speed から source 秒→タイムライン秒を解くため、cuts を後から編集し直すと
黒帯の位置がずれる）に対して実行する。

```bash
node packages/akari-tools/bin/eye-bar.mjs \
  --analysis "$OUT_DIR/analysis.json" --edit "$OUT_DIR/edit.json" --apply
```

- 既定値のままで大抵は動く（瞳間距離 ×1.6 の長さ・太さ比 0.22・移動平均 5 サンプルでの平滑化・
  0.2 秒間隔の間引き）。パラメータの全体は `eye-bar.mjs --help` 相当のヘッダコメントを参照
- `--apply` を付けない限り `edit.json` は変更されない（stdout の JSON で生成結果だけ確認できる）
- 複数人が写る素材は `--face <index>` で対象を選ぶ（v0 は 1 人だけ・複数人同時追跡は非対応）
- 黒帯素材（アルファ mov）は `.akari/cache/eye-bar/` へ自動生成される（プロジェクトの
  再生成可能キャッシュ層 — 削除しても再実行すれば作り直せる）
- 別カットアウェイ（対象人物が画面から消える区間）を挟む素材では、eye-bar は複数の
  `layers[]` エントリ（区間ごとに 1 枚）を追加する。黒帯が無関係な映像の上に浮いたまま残る
  ことを避けるための設計であり、意図した挙動である
- Vision の瞳検出が瞬き等で数フレームだけ左右を取り違えることが実測で確認されている
  （conf は 1.0 のまま角度だけ物理的にあり得ない量で跳ねる）。eye-bar 側で「直前採用値から
  45°を超える瞬時ジャンプ」を自動的に棄却しホールドで埋めるため、通常は手当て不要
  （`--outlier-max-angle-jump` で閾値変更・無効化も可）

## 消費: pose-skeleton

`body_pose_3d` を生成しただけでは何も起きない。`packages/akari-tools/bin/pose-skeleton.mjs` は、
17 関節の 2D `projection` からスティックフィギュアのアルファ付き overlay を事前ベイクし、
`kind: "baked"` の `layers[]` を出力する決定論変換器である。

```bash
node packages/akari-tools/bin/pose-skeleton.mjs \
  --analysis "$OUT_DIR/analysis.json" --edit "$OUT_DIR/edit.json" \
  --stroke-width 4 --color "#00e5ff" --joint-radius 6 \
  --smoothing 5 --min-confidence 0.3 --apply
```

- `--stroke-width` は骨線の太さ、`--color` は線と関節の色、`--joint-radius` は関節円の半径を
  指定する。`--smoothing` は移動平均 window（既定 5、`1` は平滑化なし）、
  `--min-confidence` は骨を表示する最低 confidence（既定 0.3）
- `--apply` を付けない限り `edit.json` は変更されず、stdout の JSON に生成した `layers[]` と
  baked asset の情報だけを返す。付けた場合は既存 `layers[]` へ additive に追記する
- v0 は各フレームの `bodyIndex=0` 固定で先頭の 1 人だけを消費し、複数人には非対応

## 劣化

道具が無い、生成に失敗した場合は `tracks.face_landmarks` / `tracks.hand_pose` /
`tracks.body_pose_3d` の**キー自体を書かず**に分析を確定し、理由を完了報告に書く
（person_matte の「キーは必須・値は null」という劣化表現とは違う — このトラックは真に任意であり、
キーの有無で生成済みかどうかを表す）。

## 消費側: finger-frame（指フレーム切り替え）

`tracks.hand_pose`（両手の `thumb_tip`/`index_tip` = 4 点）を「指で作ったフレームの中だけ映像が
切り替わる」演出の `layers[].keyframes`（perspective 4 隅 corner-pin）へ決定論変換する CLI。
契約 [docs/contract-2026-08-11-analysis-vision-tracks-v0.md](../../docs/contract-2026-08-11-analysis-vision-tracks-v0.md)
§4 の消費者第 2 号（本契約は変換の責務分担のみを定め、新しい 3 面実装は発生しない — §0 原則 3）。

```bash
akari internal vision-finger-frame <project> \
  --media <貼る映像のパス> [--kind video|baked] \
  [--analysis <path>] [--edit <path>] \
  [--open-threshold <0..1>] [--close-threshold <0..1>] [--min-open-duration <sec>] \
  [--apply]
```

- **発動検出**: 親指・人差し指の距離（ソース動画の実ピクセル寸法でアスペクト補正済み）が
  `--open-threshold`（既定 0.16）を両手とも超えた区間を「開き」とする。閉じるのは
  `--close-threshold`（既定 0.11、open より低い）未満へ落ちるか片手でも検出が消えたとき —
  固定引数のヒステリシスで決定論的にバタつきを防ぐ（`bin/finger-frame/gesture.mjs`）。
- **幾何**: 4 点をどの指がどの隅かに関わらず正しい `[TL,TR,BL,BR]`（#layerPerspective）へ
  正規化する（ねじれ/自己交差 quad は点集合の重心まわりの角度ソートで解消 —
  `bin/finger-frame/corners.mjs` のヘッダコメントに導出込み）。同一区間内では前フレームの
  コーナー割当に一番近い回転を選び、指の担当隅が視覚的に飛ばないようにする。
- **時間写像**: hand_pose はソース動画の秒基準、layers はタイムライン秒基準 -- `cuts[]` の
  `in`/`out`/`at`/`speed`（render-cut の `cut-timeline.mjs` を読み取り専用で再利用）から解く。
  対象カットに `framing`/`transform` の宣言があると既定 letterbox 前提が崩れるため、そのカットの
  区間はスキップし warnings に理由を残す（v0 の既知の境界。黙って誤った座標を出さない）。
- **既知の境界（v0）**: 分析はプル駆動の任意工程のまま（本節は既存ワークフローに新しいハード
  ルールを追加しない）。finger-frame 自体の詳細な設計判断・実測は
  非公開の内部記録（`akari-video-internal`）の実測記録を参照。

## よくある間違い

- 瞳・指先・身体の関節位置を使う演出を使うと決まっていない素材にも一律で実行する。
- `--kinds face,hand,body-pose-3d` を毎回指定し、必要のない重いトラックまで生成する。
- 出力された座標を「Vision は左下原点だから」と agent 側でもう一度反転する
  （ヘルパーが既に反転済み — 二重反転すると壊れる）。
- 手の関節が `joints: {}`（空）の検出を「検出失敗」と誤読してエラーにする（信頼できる
  関節が無かっただけで、手自体の検出は成立している）。
- `analysis.json` を Schema 検証する前に vision-tracks.mjs を実行し、壊れた analysis.json に
  対してトラックだけ足してしまう。
- トラックが作れなかったことを理由に `analysis.json` 自体を出さない。
