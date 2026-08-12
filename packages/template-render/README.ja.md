[English](./README.md) | **日本語**

# @akari-video/template-render

AKARI Video のテンプレート素材を、**自分の文言・色・サイズ**で動画に書き出す CLI です。

```sh
npx @akari-video/template-render ./chalkboard-jp --out my-board.mp4
```

このツールは MIT です。テンプレート素材のライセンスは素材ごとに違うので、各テンプレの
`meta.json` を見てください。

## 必要なもの

- **Node.js 20.11 以上**
- **Google Chrome**（Chromium / Edge / Brave でも可）。よくあるインストール先は自動で探します。
  見つからなければ `--chrome /path/to/chrome` で渡してください
- **ffmpeg** — 動画に束ねるときだけ必要です。`--png-sequence` なら不要

## 何を変えられるか見る

テンプレートは自分のツマミを宣言しています。聞けば出ます。

```sh
npx @akari-video/template-render ./chalkboard-jp --list-knobs
```

```
日本の緑黒板 — 変えられるツマミ 23 個

  [layout]
    --var board-width            黒板の幅  320〜3840px
    --var frame-thickness        木枠の太さ（短辺比。0 で枠なし）  0〜8
    ...
```

## 変えて書き出す

```sh
npx @akari-video/template-render ./chalkboard-jp \
  --out vertical.mp4 --size 1080x1920 --duration 5 \
  --var board-width=940 --var board-height=1200 \
  --var board-color=#1c1f1e --var frame-thickness=0 --var show-tray=0 \
  --text "今日のポイント=今日のまとめ"
```

- **単位は宣言から補います。** `--var board-width=940` は、そのツマミが `px` だと宣言されて
  いるので `940px` になります。短辺比のツマミは無単位なので数値だけ渡してください
- **`--text 旧=新`** で見本の文言を差し替えます。大きく作り変えるときは `fragment.html` を
  直接編集してください（ただの HTML です）
- 存在しないツマミ名を渡すと止まります（`--list-knobs` を案内します）

### 相対参照の素材

`fragment.html` 内の `<img src="images/photo.png">` のような相対 URL は、その fragment がある
ディレクトリを基準に解決されます。画像・フォントなどのローカル素材は fragment の隣に置き、通常の
相対パスで参照できます。絶対 `file:///` URL も引き続き利用できます。

## 出力

| 指定 | 形式 | 用途 |
|---|---|---|
| `--out demo.mp4` | H.264 / yuv420p | 共有・SNS・確認用 |
| `--alpha out.mov` | アルファ付き ProRes 4444 | Premiere / DaVinci / Final Cut にそのまま置く |
| `--png-sequence dir/` | 連番 PNG（ffmpeg 不要） | 任意の編集ソフト・独自エンコード |

`--under photo.jpg` で下に画像を敷けます。画面部分が透明なテンプレート（ブラウザモック等）は、
単色背景では良し悪しが判断できないのでこれを使ってください。

## 決定論であること

フレームの時刻は壁時計ではなく **フレーム番号 ÷ fps** から作り、アニメーションは pause して
明示的に seek します。同じ入力なら必ず同じ出力になるので、文言を直して撮り直しても
「微妙に違うテイク」ではなく素直な差分になります。

## 画面に自分の動画・写真を入れる

画面を持つテンプレート（スマホ・ノート PC・ブラウザ）は `data-akari-slot="screen"` で
差し込み口を宣言しています。ファイルを渡すだけで枠の中に入ります。

```sh
npx @akari-video/template-render ./phone-2d --out promo.mp4 \
  --size 1080x1920 --duration 5 --screen-video ./my-app-recording.mp4
```

- **決定論**: 動画は毎フレーム「フレーム番号 ÷ fps」の時刻へシークして撮ります。壁時計で
  再生させないので、撮り直しても同じファイルになります
- `--duration` より短い動画は先頭へ巻き戻して繰り返します
- 写真・スクリーンショットは `--screen-image photo.png`
- テンプレート内蔵のダミー画面は自動で消えます

## オプション

```
--out <file>            H.264 mp4（既定: demo.mp4）
--alpha <file>          アルファ付き ProRes4444 .mov
--png-sequence <dir>    連番 PNG
--screen-video <file>   動画を画面に入れる
--screen-image <file>   写真を画面に入れる
--var <名前=値>          ツマミを 1 つ変える（繰り返し可）
--vars "<css>"          まとめて指定
--text <旧=新>           見本の文言を差し替える（繰り返し可）
--list-knobs            ツマミ一覧を出して終了
--duration <秒>          既定 5
--fps <n>               既定 30
--size <幅x高さ>          既定 1920x1080
--backdrop <色>          既定 #141414
--under <画像>           背景に敷く画像
--transparent           背景を透明のまま撮る
--chrome <path>         Chrome の実行ファイル（既定は自動検出）
--ffmpeg <path>         ffmpeg の実行ファイル（既定は PATH）
```
