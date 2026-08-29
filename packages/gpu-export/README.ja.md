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

### 宣言型 3D の登場曲線（v3）

宣言型 Three.js scene は、ルート要素 1 個の登場 animation だけを GPU 経路で扱えます。
`[data-akari-active] .root, [data-no-timeline] .root` の対になった selector、両端だけの keyframe
1 本、既知の CSS timing、0 以上の delay、iteration 1 回、normal direction、`both` または
`forwards` fill が必須です。keyframe で動かせるのは opacity と 2D translate / scale だけです。
対応する CSS 変数と `calc(var(...) + Npx)` / `calc(var(...) * N)` は、書き出し前に overlay の
vars と x / y / scale transform から解決します。manifest は opacity・平行移動・scale の絶対的な
両端値を保持し、Three.js の内部 animation は従来どおりエンジンの local clock で動かしたまま、
compositor が同じ登場曲線を毎コマ評価します。

transition、`@property`、複数 animation、複数の animated element、中間 keyframe、alternate、
rotate / skew / 3D transform、filter、clip-path は、具体的な `three-entrance-*` 理由で fail-closed
になります。CSS animation のない宣言型 3D は、既存の `three-scene-canvas-direct` manifest 形と
挙動を維持します。

`render-cut --engine auto` は macOS / Windows で GPU を候補にし、プロジェクト全体が適格なら GPU、
不適格なら OSR を使います。Linux の `auto` は legacy のままで、`--engine gpu` を明示した場合だけ
GPU を評価します。明示指定は fail-closed で、全ての不適格理由または launcher の理由を表示します。

DOM 層は `--enable-features=CanvasDrawElement`、`--disable-gpu-vsync`、
`--disable-frame-rate-limit` の 3 フラグで起動します。450 / 678 / 900 コマの書き出しは 2 走の全コマ SHA と
MP4 SHA が一致しましたが、大きな文字 overlay を多数含む 5,400 コマでは、1 overlay の約 180 コマで
アンチエイリアスが確率的に変化しました（MAD 0.0001〜0.0003、差分画素 11〜41 個）。sentinel は全て一致し、
ラスタライズ関連フラグでも揺れは解消しませんでした。

毎コマの合成は土台 1 draw と、連続するスプライト種別ごとのインスタンス draw になり、字幕・DOM 層・
3D スプライトの本数が増えても draw 呼び出し回数は増えません。字幕 3 cue 同時では、字幕なしに対する
追加 GPU 時間が +1.65 ms/コマまで縮小し、`drawArrays` の合計 GPU 時間は字幕あり 3.12 ms/コマ、
字幕なし 1.47 ms/コマでした。

5,999 コマの実素材 PV では GPU 書き出しが OSR の 7.2〜8.2 倍、RSS ピークは 711〜853 MB で、
6 個の readback カウンタはすべて 0 のまま完走しました。残る字幕費用は毎コマの合成ではなく、cue 採寸と
SVG ラスタライズの起動費用です。30 cue の字幕ラスタライズには 9.95 秒かかりました。

## Windows でのセットアップ

Windows での計測には npm Electron launcher（tier 2）を使います。

```sh
git clone https://github.com/AkariLabs/akari-video
cd akari-video
npm install --ignore-scripts
node node_modules/electron/install.js
node -e "require('node:fs').writeFileSync('node_modules/electron/path.txt', 'electron.exe')"
node packages/akari-launcher/bin/akari.mjs doctor
```

doctor の期待行は `gpu_export ok (npm-electron launcher tier 2)` です。
`node_modules/electron/path.txt` の 1 行は platform 別で、Windows は `electron.exe`、macOS は
`Electron.app/Contents/MacOS/Electron`、Linux は `electron` とします。

インストール済みデスクトップアプリ launcher（tier 1）は現状 fail-closed で候補から外れます
（`GPU_DESKTOP_TIER_UNWIRED_REASON` を参照）。パッケージ版 tier 1 では shell の `extraResources` に
`packages/gpu-export` が同梱されることも前提です。v0.1.29 以降、Windows の `--engine auto` は適格なら
GPU、不適格なら OSR を使います。Linux は引き続き `--engine gpu` の明示が必要です。

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
