# キーフレーム抽出と視認

## 原則

抽出は 3 系統を併用する。scene 検出は映像の変化点を拾い、interval 抽出は変化の少ない長尺区間の見落としを防ぎ、transcript 駆動抽出は重要発言の瞬間に画を対応付ける。いずれか一方で代用しない。抽出結果は候補であり、Read で視認した画像だけを最終 `keyframes` に入れる。採用した keyframe には抽出系統を `origin`（`scene` / `interval` / `transcript`）として記録する。

## 1. シーン変化候補を抽出する

```bash
mkdir -p "$OUT_DIR/work/scene"
ffmpeg -hide_banner -nostdin -i "$OUT_DIR/proxy.mp4" \
  -vf "select='gt(scene\,0.4)',showinfo" -fps_mode vfr \
  "$OUT_DIR/work/scene/scene-%06d.jpg" \
  2>"$OUT_DIR/work/scene.log"
```

FFmpeg 公式は scene score の比較例として `0.3`〜`0.5` を妥当な選択肢とし、`0.4` の例を示している。このスキルは `0.4` を初期値にするが、素材ごとの編集適合性は要検証である。候補が過多・過少なら範囲内で調整し、値と理由を報告する。

### 0 候補時の終了コード判定

閾値 0.4 に達する変化点が 1 つもない素材（無音・静止に近い映像など）では、`select` フィルタが 0 フレームを選択し、後段の mjpeg 画像エンコーダが 0 フレームで初期化できずに ffmpeg が **非ゼロ終了（実測: exit code 234）** し、`work/scene/` に画像が 1 枚も生成されない。これは「0 候補」の正常系であり、コマンド自体は破綻していない。

ただし exit code 234 は、フィルタ式の構文ミスなど **コマンドが実際に破綻している場合にも同じ値になる**ため、終了コードの数値だけでは区別できない。`work/scene.log` の中身で判定する。

1. ログに `Stream mapping:` の行があるかを確認する。**ない場合**は入力デコードまたはフィルタグラフの構築自体が失敗しているため「コマンド破綻」として扱い、直前の `Error opening input`・`Error while parsing expression`・`Error initializing filters` 等の行を根拠に原因を報告し、候補統合へは進まず先にコマンドを直す。
2. `Stream mapping:` が**ある**場合、続けて `No filtered frames for output stream, trying to initialize anyway.` の行を探す。この行がある場合に限り「0 候補」と確定してよい。同時に `Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.`（mjpeg エンコーダ宛て）と `Nothing was written into output file, because at least one of its streams received no packets.` も現れるのが通常の随伴症状であり、追加の異常ではない。
3. `Stream mapping:` はあるが `No filtered frames for output stream` が**ない**場合は、原因不明のコマンド破綻として扱い、ログ全文を報告して停止する。

```bash
if ! grep -q '^Stream mapping:' "$OUT_DIR/work/scene.log"; then
  echo "破綻: 入力デコード/フィルタグラフ構築が失敗" >&2
elif grep -q 'No filtered frames for output stream' "$OUT_DIR/work/scene.log"; then
  echo "0 候補: scene 検出は成立、閾値 0.4 に達する変化点なし"
else
  echo "破綻: 原因不明、ログ全文を報告" >&2
fi
```

「0 候補」と確定した場合は scene 候補を空のまま、interval 候補だけで次節の統合へ進む。「破綻」と判定した場合は候補統合に進まず、入力パスやフィルタ式などコマンド側を先に修正する。

実測記録（FFmpeg 8.1.1、2026-07-14）: 無音・単色で変化のない静止動画に `select='gt(scene\,0.4)'` を適用すると exit code 234 で `work/scene/` が空になり、上記 1〜3 のログ内容が再現する。対照実験として `select` 式の構文を意図的に壊した場合も exit code は同じ 234 だが、`Stream mapping:` より前でエラーが発生し `No filtered frames for output stream` は現れない。存在しない入力ファイルを指定した場合は exit code 254 で `Stream mapping:` にすら到達しない。exit code の数値だけを見て「破綻」と誤判定しないこと、逆に非ゼロ終了を無条件で「候補なし」と決めつけないことの両方に注意する。

## 2. 一定間隔候補を抽出する

```bash
mkdir -p "$OUT_DIR/work/interval"
ffmpeg -hide_banner -nostdin -i "$OUT_DIR/proxy.mp4" \
  -vf "select='isnan(prev_selected_t)+gte(t-prev_selected_t\,10)',showinfo" -fps_mode vfr \
  "$OUT_DIR/work/interval/interval-%06d.jpg" \
  2>"$OUT_DIR/work/interval.log"
```

10 秒は FFmpeg 公式ドキュメントにある一定間隔選択の構文例を採用した運用初期値であり、編集上の最適値ではないため要検証とする。画面変化や発話密度に対して粗すぎる場合は間隔を短くし、候補が冗長なら長くして、変更を報告する。

素材長に応じた間隔の目安（**要検証の運用初期値**。視認可能な候補総数を 30〜60 枚程度に収める意図）:

| 素材長 | interval 目安 |
|---|---|
| 〜10 分 | 10 秒 |
| 10〜30 分 | 30〜60 秒 |
| 30 分〜 | 120 秒 |

実測記録（2026-07-14）: 62 分素材に 10 秒間隔を適用すると 374 候補になり視認が非現実的だったため、120 秒（32 候補）へ調整した。transcript 駆動抽出（次節）が重要発言を直接拾うため、interval は「映像側の取りこぼし保険」として粗めでよい。

一次資料: [FFmpeg Filters Documentation — select examples](https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect)

## 3. transcript 駆動候補を抽出する

[events-and-hooks.md](events-and-hooks.md) の手順で transcript から下書きした `highlight` 候補（および hook 候補）の時刻から、フレームを 1 枚ずつ抽出する。transcript が空の素材ではこの系統をスキップし、完了報告に明記する。

```bash
mkdir -p "$OUT_DIR/work/transcript"
# highlight 候補ごとに、代表時刻 T（初期値: (start + end) / 2）で 1 枚
ffmpeg -hide_banner -nostdin -ss "$T" -i "$OUT_DIR/proxy.mp4" \
  -frames:v 1 "$OUT_DIR/work/transcript/tr-000001-t$T.jpg"
```

- 代表時刻の初期値は発言区間の中央とする。視認して発言内容と画が対応しない場合（画面切り替えの狭間、話者が映っていない等）は、同じ区間内で `start` / `end` 側へずらして再抽出してよい。区間外から取らない
- 抽出元の highlight / hook 候補との対応（どの event のための画か）を `work/` 内の対応表に控える。視認後の note 記入と `origin: "transcript"` の記録に使う

## 4. source 時刻を回収して統合する

各ログの `showinfo` 行にある `pts_time` を、同じ実行で出力された画像の連番順に対応付ける。連番そのものを秒にしない。scale だけのプロキシは source 時刻を維持するが、原本とプロキシの duration・開始時刻も照合する。transcript 駆動候補は `-ss` に与えた時刻をそのまま使う。

scene、interval、transcript の 3 系統の候補を source 時刻順に統合する。統合時に「最終連番 → 元候補ファイル名（系統込み）」の対応表を `work/mapping.txt` 等に書き残す（note との対応ずれを後から追跡できるようにする）。同一時刻または視覚的に同一の隣接画像は、Read で比較して情報量の高い方だけを残す。ただし transcript 駆動候補は重要発言の証拠なので、見た目が近くても安易に落とさず、落とす場合は対応する event との紐付けを残した方を優先する。最終画像は次のように安定した名前で `keyframes/` へ置く。

```text
keyframes/kf-0001-t12.000.jpg
```

ファイル名の時刻は検索補助であり、`keyframes[].t` の数値を正とする。小数 3 桁は命名上の初期精度であり、フレーム精度を保証する閾値ではない。採用した各 keyframe には、どの系統から来たかを `origin`（`scene` / `interval` / `transcript`）として記録する。

## 5. Read で視認する

最終採用前に各候補画像を Read で開く。長尺素材ではバッチに分けてよいが、未視認画像へ `note` を書かない。**note は必ず重複除外が確定した後の最終ファイル一覧に対して書く**（除外前の候補順で先読みして書くと、除外された枠の分だけ後続の note が前倒しでずれる連鎖事故が起きる。実測: 62 分素材で 5 件連鎖 + 入れ替わり 2 件）。**note は画像を Read した直後にその場で書き、`work/mapping.txt` の対応（連番・時刻・系統）と照合してから次の画像へ進む**。各 note は、画像だけから確認できる次の情報を日本語で簡潔に記す。

- 人物・画面・資料などの主対象
- UI、スライド、タイトル、エラー表示などの状態
- 直前候補から生じた見た目上の変化
- 後工程の根拠になる構図、顔の有無、文字の可読性

「重要そう」「盛り上がっている」だけで終えず、そう判断できる可視事実を書く。音声内容や人物の意図をフレームだけから推測しない。

取り違えリスクが高い箇所には追加の確認を掛ける。

- **準重複クラスタ**（同一シーンで時刻差が数秒未満の候補が並ぶ区間、直前直後で候補除外が起きた区間）は隣接フレームとの note 取り違えが起きやすい。書いた直後にその区間だけ note と画像を再突合する。
- ボタンラベル・件数などの**小さい UI 文字列**を note に引用する場合は、該当領域を拡大して読み取ってから書く（誤読・数値取り違えの実例あり）。
- 全 note 記入後、`note[i]` と `path[i]` の画像を機械的な順走査でもう一周突合する self-review を行ってから確定する。

Read が画像を開けない場合は note を捏造しない。`keyframes: []` に劣化するか、別の読み取り可能な画像形式へローカル変換して再試行し、未実施の視認工程を報告する。視認なしで分析完了とはしない。

## 6. 人物情報へ反映する

顔トラックを作る場合は、視認またはローカル検出で確認した時刻だけを記録する。box は `[x, y, width, height]` をフレーム幅・高さで正規化した値とし、各値を 0〜1、かつ `x + width <= 1`、`y + height <= 1` にする。話者と顔の対応を確認できなければ `tracks.faces: []` とし、見た目だけで speaker を断定しない。

人物マットはこの工程で自動生成しない。既に生成済みで、対象 source と時刻対応を確認できる場合だけ `tracks.person_matte` に値を書き、それ以外は `null` とする。人物演出を使うと決めた素材で新たに生成する場合だけ、[person-matte.md](person-matte.md) の任意工程を実行する。

## よくある間違い

- scene 候補だけで、静止画面が続く重要区間を見落とす。
- interval 候補だけで、短いエラー画面や切り替わりを見落とす。
- transcript 駆動候補を作らず、重要発言の瞬間の画を interval の偶然に頼る。
- `scene-000012.jpg` を 12 秒地点だと解釈する。
- Read せずにファイル名や transcript から画像 note を作る。
- 複数画像の note をまとめて後から書き、隣接候補と note を入れ替える。
- transcript 駆動候補の代表時刻が画面切り替えの狭間に落ちたまま、区間内での再抽出をしない。
- 同じ絵を大量に keyframes へ残し、レポートの根拠を薄める。
- 顔 box の右端・下端が正規化座標 1 を越える。
- scene 検出の exit code 234 を見ただけで「候補ゼロ」と即断し、ログ本文（`Stream mapping:` / `No filtered frames for output stream`）を確認しない。
- 逆に非ゼロ終了を一律「コマンド破綻」として原因調査せず止める。
