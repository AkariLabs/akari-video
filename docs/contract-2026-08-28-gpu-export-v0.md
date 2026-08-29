# GPU 直結書き出し v0 契約

## 1. 適用範囲

この契約は `render-cut --engine gpu` と `packages/gpu-export` が提供する第 2 の映像出口を定める。
共有 frame-engine の完成 canvas を `VideoFrame(canvas)`、WebCodecs `VideoEncoder`、mp4box direct mux
の順に渡す。raw RGBA/BGRA の読み戻し、renderer-to-main の raw frame pipe、CPU 色変換、映像の
再エンコードは行わない。

評価は先頭から末尾まで 1 process、1 timeline、連番で行う。区間並列と複数 process 並列は v0 の
決定論契約に含めない。エンコーダ投入は `encodeQueueSize` と有界 `queueDepth` で制御する。

## 2. 適格性

適格性は宣言時に HTML 文字列、字幕 cue、編集宣言から機械判定する。結果は全件 receipt に残す。

| 分類 | 適格 | 意味 |
|---|---|---|
| `same` | はい | 静的 HTML は起動時、対応済み字幕は unit の初回活性時に 1 回だけスプライト化する |
| `three` | はい | JSON の宣言型 3D scene と描画先 canvas を持つ overlay。毎コマ Three.js canvas を更新する |
| `degraded` | いいえ | raster 自体は可能でも live DOM と同じ時間変化を保証できない |
| `unsupported` | いいえ | v0 の表現範囲外であり、正しい完成画を生成できない |

自由 HTML は、絶対 URL、外部 font/image/background、runtime script、iframe/object/embed、canvas/video、
CSS animation/transition/keyframes、filter/mask/clip-path 等を検出する。条件がない静的 HTML だけを
`same` とする。例外として、検出条件が `three-or-canvas-runtime` だけで、
`<script type="application/json" data-akari-3d-scene>` 宣言を属性順にかかわらずちょうど 1 個持ち、
それ以外の script と video を持たない宣言型 3D は `three` とする。3D の描画先である canvas は許可する。

字幕は cue ごとに rasterize し、出現・loop・消失を解析的な opacity と中心基準 affine 変換で
再現する。v2 では `words[]` を持つ karaoke、pop、reveal、reveal-word と `emphasis_words` も
語矩形タイルとして GPU-native に合成する。次は引き続き `unsupported` とする。

- 同一 unit に karaoke の色補間と、pop / one-char-bang / one-char-jumble / size-pulse の幾何変形が混在するもの。
- 語矩形タイルで再現できない縦書きの語単位字幕。
- 未知の motion、および clip-path を使う push/typewriter/wipe/glitch。
- `transform-origin: top center` を必要とする swing。

### 2.1 語単位字幕（v2）

語単位字幕の意味論は `packages/render-cut/src/captions.mjs` が生成する DOM と CSS を正本とする。
GPU 出口はその DOM を別実装で組み直さず、同じ DOM から `getClientRects()` で各語の矩形を採寸する。
1 語が改行をまたいで複数矩形を返す場合は全矩形を保持する。縦長出力で style 無指定かつ
`words[]` があり複数行になる cue は、正本と同じ行分割関数で reveal へ自動昇格する。
採寸は独立した DOM root の挿入ごとに行い、全 variant の全測定値が 2 回連続で厳密一致するまで
測り直す。上限は 32 回とし、収束しなければ `caption-measure-unstable` を理由コードと warning に残して
fail-closed とする。HW で max 6、soft で max 7 だった実測に対する余裕として 32 回を採る。
許容差、平均、丸めによって走間の揺らぎを隠さない。

| 対象 | 毎コマの状態 |
|---|---|
| karaoke | 語の start まで基本色、start〜end は語全体の色を linear 補間、end 以後は highlight 色 |
| pop | start から 0.2 秒、語矩形中心で `translateY(0→-0.08em→0)` と `scale(1→1.12→1)` |
| reveal-word | start から 0.01 秒で opacity 0→1 |
| reveal | 行群を 0/12/99.99/100% の opacity・translateY keyframe で順送りし、前群は終了時に消す |
| one-char-bang / one-char-jumble | 文字ごとに opacity 0→1、scale 1.6→1。jumble の静的変形はラスタへ保持 |
| size-pulse | 語矩形中心で scale 1→1.25→1 |
| 色・太さ・縁取りだけの emphasis | 静的な基本ラスタへ焼き込み、毎コマの状態評価はしない |

karaoke は左から右へのワイプではない。正本の keyframes は `color` の from/to だけなので、基本色と
highlight 色の 2 ラスタを語タイル内で時間比率により mix する。CSS timing function は keyframe 区間ごとに
適用し、pop と size-pulse の 0〜50% / 50〜100% をそれぞれ ease してから補間する。

ラスタ単位を unit と呼ぶ。通常は cue 1 個、reveal は重なった `.akari-caption__reveal-group` 1 個を
unit 1 個とする。unit ごとのラスタは最大 2 枚で、色モードは基本色 / highlight 色、幾何モードは
プレート背景 / 透明背景の文字、状態なしは基本 1 枚だけを持つ。2 状態 DOM の全語矩形は各成分差
0.01 px 以下であることを起動時に検査し、超過は fail-closed とする。ラスタは unit ごとに 1 回だけ作り、毎コマは
行ストリップと語境界でフレームを隙間なく分割した整数タイルを配列順に合成する。3 枚目や毎コマ rasterize は行わない。

ラスタ SVG はフレーム全面ではなく、出力幅を維持した字幕帯だけの `viewBox` を持つ。開始時刻順の
連続する最大 8 unit、かつ全バンド高 4096 px 以下を 1 バッチとし、各 unit の 1〜2 状態を縦方向の
バンドとして 1 枚の SVG に積み、デコードはバッチにつき 1 回だけ行う。variant CSS は
`data-akari-band` ごとにスコープし、埋め込みフォントの `@font-face` は SVG 内に 1 本だけ置く。
初めて必要になった unit のバッチをまとめて登録する一方、GPU texture は活性区間の終了時に unit ごとに
解放し、バッチのために寿命を延ばさない。upload 後の切り出し用 CPU canvas とデコード画像も破棄する。

SVG の入力は data URL に固定する。Blob URL と同一オリジン HTTP URL は SVG 内フォントを含む canvas を
汚染し、`getImageData` だけでなく `texImage2D(canvas)` も `SecurityError` になるため使用しない。
フォント data URL は `encodeURIComponent` 済みの文字列を 1 度だけ作って再利用し、生の base64 を
キャッシュしない。

適格な cue は理由 `words-native` とし、receipt に `mode`（`sprite` / `words-native`）、style、unit 数、
語数、ラスタ枚数、バンド数、タイル数と `captionLayoutMaxDeltaPx`、採寸試行の count / p50 / max、
バッチ実測、字幕ラスタ合計時間を記録する。未知 style は
`caption-style-unsupported:<value>`、色と幾何の混在は `words-native-color-and-geometry-mixed` とする。

検収は style 5 種 × 各 5 時刻について GPU / OSR decode の画面下 1/4 MAD 1.0 以下、語境界の対比画像
6 枚以内の目視、語状態評価と合成の追加コスト中央値 1 ms/コマ以下、hardware / software の指定 fixture
2 走一致、製品経路の読み戻し 0 を要求する。性能 gate は cue ラスタ p50 500 ms 以下、karaoke 44 cue の
akari-video-pv 18 ms/コマ以下、小 fixture（360 コマ・3 cue）の RSS peak 900 MB 以下とする。

`--engine auto` は macOS で全件適格なら `gpu`、不適格なら `osr` を選ぶ。他 OS の `auto` は従来の
選択を維持する。明示 `--engine gpu` と不適格の組み合わせは理由を全件表示して fail-closed とし、
黙って OSR へ変更しない。GPU launcher が利用できない明示指定も fail-closed とする。

## 3. 合成順と LUT

frame-engine canvas は cuts、layers、transition、matte、LUT を評価する。最終 canvas では、その上へ
静的 HTML、3D、字幕の順でスプライトを合成する。したがって LUT は映像 engine canvas 内だけに適用し、
字幕・HTML・3D は LUT の外に置く。全 upload は `uploadPath = "direct"` を必須とし、fallback を検出した
コマで書き出しを停止する。

3D は engine の時計から得た local seconds を `threeRuntime.render(container, t)` へ直接渡して駆動する。
GPU 出口は overlay sheet の `__akariSeek` を使用しない。毎コマの DOM animation 同期、全 container の
visibility 更新、video seek 待ちを 3D canvas の texture 更新へ持ち込まないためである。sheet の
`__akariReady` は起動時に 1 回だけ待ち、各 scene が ready でない場合は overlay id と状態を示して
fail-closed にする。active 区間は最終 compositor の draw へ積むかどうかで決める。

## 4. 読み戻しゼロ

製品実行経路は GPU frame surface を CPU へ読む API を使用しない。静的監査は
`src/verify-readback.js` だけを除外して、WebGL/2D pixel read、`VideoFrame` の byte copy、bitmap 化、
canvas の data/blob export が 0 件であることを要求する。エンコード済み H.264 byte 列の取り出しは
raw frame 読み戻しではない。

`AKARI_GPU_TRAP_READBACK=1` または `--trap-readback` は該当 API を throw 化し、呼び出し counter 0 の
まま完走することを要求する。検証専用の生フレーム SHA 経路は別 module に隔離し、trap と同時には
有効化できない。

## 5. エンコード、mux、音声

映像は H.264 `avc1.640028`、2 秒ごとの keyframe とし、製品は hardware preference、
`--soft` は software preference を指定する。ビットレートは render-cut の quality プリセットにある
VideoToolbox 値を正本とし、`high = 12 Mbps`、`standard = 8 Mbps`、`light = 5 Mbps` とする。
`--bitrate` の明示値は quality より優先する。`master` は VideoToolbox ビットレートを宣言しないため、
GPU 出口では `--bitrate` が無ければ理由付きで fail-closed にする。

エンコード済み Annex B sample を main process へ渡し、
SPS/PPS または decoder config から avcC を作って mp4box へ直接格納する。追加の映像 process は起動しない。
MP4 の時刻は timescale 1,000,000 上で各境界を `round(frameIndex × timescale / fps)` として求め、
各 sample duration を隣接境界の差にする。track の `duration` / `media_duration` は全 sample duration の
総和、すなわち `round(frames × timescale / fps)` と一致させ、1 コマ尺の丸めを累積してはならない。

GPU 映像は video-only である。現行の正典 audio filtergraph が入力 0 の音声を読めるよう、元の cut 音声を
copy し、音声がない場合は `frames / fps` 秒の無音 carrier を付ける。以後の mux は `-c:v copy` と
`-t frames/fps` を必須とする。最終 MP4 の映像コマ数は要求値と厳密一致し、不一致は fail-closed とする。
A/V 終端差は 1 コマ以内を要求する。

## 6. 決定論とパリティ gate

| mode | 必須条件 |
|---|---|
| hardware | 指定 fixture を同一機で 2 走し、全コマ SHA-256 と MP4 SHA-256 が一致 |
| software | 360 コマ fixture を 2 走し、エンコード前の生フレーム SHA-256 が 360/360 一致 |
| software H.264 unsupported | `unsupported` を receipt に残し、生フレーム SHA だけを必須とする |

software MP4 SHA はエンコーダが決定論的な場合だけ必須とし、それ以外は警告を伴う診断値とする。
GPU と OSR の decode 比較は、engine-only 区間の per-frame MAD 1.0 以下、字幕 cue の代表 5 時刻の
下半分 MAD 1.0 以下、3D 区間 MAD 1.0 以下を固定閾値とする。

## 7. receipt

`.akari/render.json` は `provenance.engine = "gpu"` と GPU receipt を持つ。GPU receipt は少なくとも
次を記録する。

```json
{
  "provenance": {
    "engine": "gpu",
    "launcher_tier": 2,
    "mux": "mp4box-direct",
    "video_reencode": false
  },
  "gpu": {
    "encoder": "WebCodecsH264Encoder",
    "hardware": "prefer-hardware",
    "uploadPath": "direct",
    "quality": "high",
    "bitrate": 12000000,
    "queueDepth": 4,
    "rss_peak": 0,
    "readback": {},
    "eligibility": []
  }
}
```

`gpu.eligibility[]` は overlay/caption/edit の id、4 分類、理由、検出条件を省略せず並べる。memory は
OSR receipt と同じ warning/hard-stop 語彙を使う。`--engine osr` と `--engine gpu` は receipt 以外の
最終成果物パス・命名と `.akari/render.json` の置き場を共有する。

## 8. v0 / v2 の限界

- 語矩形で表せない演出、色補間と幾何変形が同居する cue、縦書きの語単位字幕は glyph atlas 等の次段が必要。
- 動的自由 HTML は OSR または事前ベイクが必要。
- Windows の hardware H.264 encoder は v0 の提供対象外。
- 長尺の区間並列、複数 process 並列は非対応。
- ~~インストール済みデスクトップアプリ経由（launcher tier 1）の GPU 書き出しは未配線~~ **2026-08-29 解消**: shell の `electron-entry.js` が `--akari-main packages/gpu-export/src/electron-main.mjs` を受け、`buildElectronArguments` が tier 1 にそれを渡す（osr 契約 §6）。`resolveGpuLauncher` の fail-closed（allowDesktop 既定 false）は v0.1.28 で解除。以下は v0.1.26〜v0.1.27 の記録: （v0.1.25 で判明）。shell の `--render` は OSR ランタイムしか読まず、`buildElectronArguments` は tier 2 にしか mainScript を渡さない。v0.1.26 から `resolveGpuLauncher` は tier 1 を候補から外す（fail-closed）: `auto` は OSR へ（provenance に `engine_fallback` と理由）、`--engine gpu` 明示は拒否。tier 1 の配線（shell contribution に GPU ランタイム選択を足す）は別票。

## 9. v1 — HTML-in-Canvas DOM 層

v1 は、CSS animation、transition、`@keyframes`、Web Animations、`@property` で時間変化する自由 HTML を
`dom` 分類として適格化する。書き出し時だけ動的に生成した `canvas[layoutsubtree]` の子へ DOM を mount し、
エンジン時計で元の animation を pause・seek してから `drawElementImage` で透過 2D canvas へ転写する。
その canvas は `SpriteCompositor.updateSprite` で直接 texture 化する。Three.js canvas は従来の別 texture の
ままとし、DOM host へ入れない。

GPU 出口だけに `--enable-features=CanvasDrawElement`、`--disable-gpu-vsync`、
`--disable-frame-rate-limit` を付け、`--force-device-scale-factor=1` を維持する。DOM ランは `overlays[]` の
宣言順で連続する項目をまとめ、静的 HTML、3D、DOM ランを元の index 順に合成したあと、字幕を最後に載せる。
すべて LUT の外である。

次の条件は fail-closed のまま `degraded` とし、receipt に overlay id、理由、検出条件を全件残す。

- `iframe`、`object`、`embed` の埋め込み context。
- `perspective`、`preserve-3d`、`rotateX/Y/3d`、`matrix3d`、`translateZ/3d` のいずれかを含む
  CSS 3D transform。先行実験では `translateZ` 単独・`perspective` 単独は正しく転写できたため、
  将来はこの粒度まで緩和できる余地があるが、v1 では緩和しない。
- `requestAnimationFrame`、`setTimeout`、`setInterval`、`Date.now`、`performance.now` で自走する時計。
- `video`、`audio`、canvas/宣言型 3D 以外の runtime、JSON 以外の script。
- 絶対 URL と外部 font/image/background resource。
- `drawElementImage` が利用できない実行環境、または device pixel ratio が 1 でない環境。

settle は mount 時に一度だけ決める。`canvas.requestPaint` がある Chromium では rAF 2 回の後に
`requestPaint()` と `paint` event（上限 250 ms）を待つ。API がない Chromium では computed style、
bounding rect、host height を同期読みして layout を確定し、直ちに転写する。採用 policy、API probe、
DOM 層の固定・待機・転写・upload の p50/p95 は receipt の `gpu.domLayer` に記録する。

`--verify-frames` では各 DOM ラン左上の 8×8 sentinel を frame number から決定論的に着色し、転写後
texture の左上 4×4 が期待 RGB の ±8 に一致するかを毎コマ検査する。CSS `mod()` の自己検査に失敗した
環境では JS channel 指定へ切り替え、その mode も記録する。pixel read は
`src/verify-readback.js` に隔離した検証経路だけに許可し、製品経路の読み戻しゼロ契約は変えない。

DOM 層の OSR decode 比較は overlay 外接矩形内 MAD 1.0 以下を、animation 開始時刻を含む代表 5 時刻で
要求する。sentinel は全要求 frame 一致を必須とする。既知の限界は karaoke の word texture、CSS 3D、
自走時計、3D scene の DOM 入場 animation、OSR/legacy に残る `@property` animation の時刻不整合である。

決定論には長尺時の既知の限界がある。短い書き出し（実測 450 / 678 / 900 コマ）は 2 走の全コマ SHA と
MP4 SHA が一致した。一方、大きな文字を持つ DOM overlay を多数含む長い書き出し（実測 5400 コマ）では、
1 つの overlay 区間に閉じた 180 コマ前後で文字の縁のアンチエイリアスが走ごとに変わり、全コマ SHA 一致が
確率的に崩れた（MAD 0.0001〜0.0003、差分画素 11〜41 個）。sentinel は全走一致しており 1 コマ遅れではない。
ラスタライズ関連の起動フラグでは解消しなかった。

**検収裁定（2026-08-29・司令塔）**: DOM 層を含む書き出しの HW 決定論 gate は「2 走の全コマ SHA 一致」ではなく
**「全コマの per-frame MAD ≤ 0.001 かつ sentinel 全一致」を一致とみなす**。上記の文字縁アンチエイリアス差（最大 0.0003）は
この範囲内であり不可視・1 コマ遅れでもないため受け入れる。DOM 層を含まない書き出し（エンジン層・静的スプライト・
語単位字幕のみ）は従来どおり SHA 一致を要求する。

速度にも字幕起動コストの既知の限界がある。字幕 cue はページ起動時に 1 枚ずつ SVG へ焼くため、実測では
30 cue の焼き込みが 900 コマの書き出しに約 47 秒（約 52 ms/コマ相当）を上乗せし、字幕を含む短い
書き出しでは GPU 出口が OSR より遅くなった。同じ題材から字幕を外すと GPU は 19.2 ms/コマ、OSR は
40.9 ms/コマだった。
