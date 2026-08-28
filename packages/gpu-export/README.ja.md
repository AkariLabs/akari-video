[English](./README.md) | **日本語**

# GPU 書き出し

`@akari-video/gpu-export` は、適格な AKARI Video プロジェクト用の GPU 直結 H.264
書き出し経路です。共有 frame-engine を先頭から逐次評価し、対応する DOM 由来スプライトを
WebGL2 canvas 上で合成し、その canvas を `VideoFrame` と WebCodecs へ渡します。エンコード済み
Annex B sample は mp4box で MP4 へ直接格納します。raw frame の Node 転送や ffmpeg pipe はありません。

## 適格性

GPU 経路は、静的 HTML スプライト、対応済み字幕モーション、宣言型 Three.js scene、frame-engine
layer を扱います。動的 HTML、埋め込み context、外部 resource、clip-path を使う字幕モーションは
扱いません。

### 語単位字幕（v2）

karaoke、pop、reveal、reveal-word と対応済み `emphasis_words` は GPU-native です。字幕 unit は
初回活性時に最大 2 状態だけラスタライズし、正本の字幕 DOM から採寸した語矩形により、毎コマの色補間、
表示、アフィン変形を駆動します。karaoke は左から右へのワイプではなく、DOM と同じ語全体の色補間です。
receipt には `sprite` / `words-native` と unit・語・ラスタ・タイル数、2 状態のレイアウト差を記録します。

ラスタ texture は出力幅を維持したまま字幕帯だけを縦方向に crop します。unit が初めて活性化したときに
開始時刻順の最大 8 unit / バンド高 4096 px のバッチを data URL で 1 回だけ decode し、variant CSS は
バンド単位にスコープ、埋め込み font は SVG 内 1 本にします。採寸は厳密一致が 2 回続くまで最大 32 回
行い、GPU texture は従来どおり unit 終了時に解放します。canvas / WebGL を汚染する Blob・HTTP URL は
使用しません。

karaoke の色変化と幾何 emphasis の混在、縦書きの語単位字幕、未知の word style は引き続き不適格で、
具体的な理由を付けて fail-closed になります。

`render-cut --engine auto` は macOS でプロジェクト全体が適格な場合だけ GPU を使い、それ以外は
OSR を使います。`--engine gpu` の明示指定は fail-closed で、全ての不適格理由を表示します。

## 開発

```sh
npm test
npm run assert-zero-readback
npm run bundle:frame-engine
npm run check:frame-engine-drift
```

frame-engine bundle は生成物です。`generated/frame-engine.js` を直接編集しないでください。
生フレーム hash は隔離した検証専用 module からだけ利用でき、実行時 readback trap とは同時に
有効化できません。
