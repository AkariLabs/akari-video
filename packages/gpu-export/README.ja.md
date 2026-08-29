[English](./README.md) | **日本語**

# GPU 書き出し

`@akari-video/gpu-export` は、適格な AKARI Video プロジェクト用の GPU 直結 H.264
書き出し経路です。共有 frame-engine を先頭から逐次評価し、対応する DOM 由来スプライトを
WebGL2 canvas 上で合成し、その canvas を `VideoFrame` と WebCodecs へ渡します。エンコード済み
Annex B sample は mp4box で MP4 へ直接格納します。raw frame の Node 転送や ffmpeg pipe はありません。

## 適格性

GPU 経路は、静的 HTML スプライト、対応済み字幕モーション、宣言型 Three.js scene、frame-engine
layer に加え、CSS animation、transition、keyframes、Web Animations、`@property` で動く宣言的な
動的 HTML を扱います。動的 HTML は実行時に作る `canvas[layoutsubtree]` の下へ mount し、エンジン時計へ
固定して `drawElementImage` で転写し、製品経路で pixel を読み戻さず compositor texture へ載せます。

埋め込み context、CSS 3D transform、JavaScript の自走時計、media element、runtime script、外部
resource は fail-closed です。karaoke などの語単位字幕と強調語は v1 でも対象外です。

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

DOM 層は `--enable-features=CanvasDrawElement`、`--disable-gpu-vsync`、
`--disable-frame-rate-limit` の 3 フラグで起動します。450 / 678 / 900 コマの書き出しは 2 走の全コマ SHA と
MP4 SHA が一致しましたが、大きな文字 overlay を多数含む 5,400 コマでは、1 overlay の約 180 コマで
アンチエイリアスが確率的に変化しました（MAD 0.0001〜0.0003、差分画素 11〜41 個）。sentinel は全て一致し、
ラスタライズ関連フラグでも揺れは解消しませんでした。

字幕 cue はページ起動時に 1 枚ずつ SVG sprite へ焼くため、30 cue では 900 コマに約 47 秒
（約 52 ms/コマ相当）が加わり、字幕付き短尺の GPU 出口は OSR より遅くなります。字幕を外した同じ題材は
GPU 19.2 ms/コマ、OSR 40.9 ms/コマでした。

## 開発

```sh
npm test
npm run assert-zero-readback
npm run bundle:frame-engine
npm run check:frame-engine-drift
```

frame-engine bundle は生成物です。`generated/frame-engine.js` を直接編集しないでください。
生フレーム hash は隔離した検証専用 module からだけ利用でき、実行時 readback trap とは同時に
有効化できません。DOM frame 検証は隔離した texture sentinel を使い、選択した settle policy
（`raf2-paint-event` または `sync-layout`）を receipt に記録します。
