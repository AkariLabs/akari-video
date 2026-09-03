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
自由 HTML の判定は、`<!-- ... -->` の HTML コメントを除去した文字列に対して行う。コメント内の
`data-akari-3d-scene`、タグ、URL、CSS 語彙は適格性へ影響させず、CSS コメントと
`<script type="application/json">` の内容は従来どおり判定対象の文字列に残す。

| 分類 | 適格 | 意味 |
|---|---|---|
| `same` | はい | 静的 HTML は起動時、対応済み字幕は unit の初回活性時に 1 回だけスプライト化する |
| `three` | はい | JSON の宣言型 3D scene と描画先 canvas を持つ overlay。毎コマ Three.js canvas を更新し、登場表現は `three-scene-entrance-curve` または `three-scene-entrance-sampled` で処理する |
| `degraded` | いいえ | raster 自体は可能でも live DOM と同じ時間変化を保証できない |
| `unsupported` | いいえ | v0 の表現範囲外であり、正しい完成画を生成できない |

自由 HTML は、絶対 URL、外部 font/image/background、runtime script、iframe/object/embed、canvas/video、
CSS animation/transition/keyframes、filter/mask/clip-path 等を検出する。条件がない静的 HTML だけを
`same` とする。例外として、検出条件が `three-or-canvas-runtime` だけで、
`<script type="application/json" data-akari-3d-scene>` 宣言を属性順にかかわらずちょうど 1 個持ち、
それ以外の script と video を持たない宣言型 3D は `three` とする。3D の描画先である canvas は許可する。

`data-akari-slot` への文言注入（`source.params`。正本 `contract-2026-08-22-overlay-html-slots.md`）は、
静的 HTML のスプライト化の直前と DOM 層の mount 時に、legacy の rasterize / プレビューの overlay-runtime と
同じ `packages/overlay-runtime/src/slot-params.js` の `renderTextSlots` で適用する。params を持つ overlay が
1 件でもあればページに同 runtime を inline し、receipt の manifest に `textSlotOverlayCount` を残す。
params があるのに runtime が無い状態は既定文言を黙って焼かず fail-closed にする（2026-08-31・issue #32）。

frame-engine のメイン時間軸（cuts）は静止画ソース（edit-store の `isStillImageSourcePath`）を
`kind: 'image'` の base 層として描く（尺は `out - in`・ソース時刻なし・transform / crop / keyframes は動画 cut と
同じ。正本 `contract-2026-08-12-still-image-cut-source-v0.md`。2026-08-31・issue #30）。2 本目以降の visual
トラックの映像クリップは `at` / `track` を保持して絶対配置し、番号が大きいトラックが前面（v2 の `tracks[]` 配列順）。
track 0 は従来どおり連結チェーン（freeze で伸び、トランジション重なりは宣言から再計算）のまま
（2026-08-31・issue #31。それまでは GPU / OSR の runtime が導出 `at` / `track` を全 cut から外していたため、
上段のクリップが直列に連結されて出力尺の外へ押し出され、PASS のまま絵が消えていた）。同じ規則を
frame-engine へ cuts を渡す残り 2 面（preview-server の Web UI プレビュー・シェルのプレビュー）にも適用し、
プレビューと書き出しが同じ絵を出す（preview parity。シェルは `renderTrack` の最小値を最下段とみなす）。

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

`--engine auto` は全 platform で全件適格なら `gpu`、不適格なら `osr` を選ぶ。明示
`--engine gpu` と不適格の組み合わせは理由を全件表示して fail-closed とし、
黙って OSR へ変更しない。GPU launcher が利用できない明示指定も fail-closed とする。

## 3. 合成順と LUT

frame-engine canvas は cuts、layers、transition、matte、LUT を評価する。最終 canvas では、その上へ
静的 HTML、3D、字幕の順でスプライトを合成する。したがって LUT は映像 engine canvas 内だけに適用し、
字幕・HTML・3D は LUT の外に置く。全 upload は `uploadPath = "direct"` を必須とし、fallback を検出した
コマで書き出しを停止する。

cuts と layers が同時に空のフレームは、出力解像度の黒 1 枚として合成する。その後の静的 HTML、3D、字幕の
スプライト合成は通常どおりこの黒い frame-engine canvas の上へ重ねる。

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

映像は H.264 High profile とし、level は解像度・fps・ビットレートを満たす最小値を H.264 Table A-1
（MaxFS / MaxMBPS / MaxBR × 1.25）から導出する。下限は Level 4.0 で、1080p30 = `avc1.640028`（従来と
バイト同一）、1080p60 = `avc1.64002a`、1440p30 = `avc1.640032`、4K30 = `avc1.640033`、4K60 = `avc1.640034`。
`codec` オプションで明示の文字列に上書きできる（2026-09-01 改訂。固定 `avc1.640028` は Blink の
`VerifyCodecSupportStatic` が MaxFS 8192 MB 超を拒否するため、1440p / 4K が HW / SW を問わず全 OS で
`isConfigSupported=false` になっていた — 2026-08-29 調査 §5-4）。
2 秒ごとの keyframe とし、製品は hardware preference、
`--soft` は software preference を指定する。ビットレートは render-cut の quality プリセットにある
GPU ビットレート値（mac では VideoToolbox 用の値と共用）を正本とし、**1080p（1920×1080）基準**で
`high = 12 Mbps`、`standard = 8 Mbps`、`light = 5 Mbps` とする。出力ピクセル数が 1080p を超えるときは
その比で増やし（4K = 4 倍で `high = 48 Mbps`、1440p ≈ 1.78 倍、100 kbps 単位に丸め）、基準未満は 1 倍に
留める（2026-09-01 改訂。receipt の `bitrateSource` は `quality-preset-scaled`）。
`--bitrate` の明示値は quality より優先し、スケールしない。`master` は VideoToolbox ビットレートを宣言しないため、
GPU 出口では `--bitrate` が無ければ理由付きで fail-closed にする。

エンコード済み Annex B sample を main process へ渡し、逐次 muxer が SPS/PPS または decoder config から
avcC を作って `out.mp4` へ直接書き足す。映像の仮ファイルも追加の映像 process も作らない。
MP4 の timescale は `frameRateRational(fps)` が返すレート分子、1 コマは同じ関数が返す分母ティックとし、
track duration は `frames × frameTicks` にする。dts = cts とし、ctts は持たない。
`frames` から計算した上界の `free` 箱を `ftyp` の直後に予約し、finish で moov をその先頭へ上書きして
余りを `free` として残す。mdat は先頭から 64-bit largesize、サンプル位置は co64 で表し、本文を移動せず
moov を mdat より前に置く。2026-09-01 改訂。#37（ffmpeg remux・2026-08-31〜09-01）を経てこの形へ移行した。

GPU 映像は video-only である。現行の正典 audio filtergraph が入力 0 の音声を読めるよう、元の cut 音声を
copy し、音声がない場合は `frames / fps` 秒の無音 carrier を付ける。以後の mux は `-c:v copy` と
`-t frames/fps` を必須とする。最終 MP4 の映像コマ数は要求値と厳密一致し、不一致は fail-closed とする。
A/V 終端差は 1 コマ以内を要求する。

2026-09-02 追記（issue #43）: 上記の無音 carrier は、**明示された音声ソース**に音声ストリームが
無い場合だけ付ける。音声ソース未指定時は audio muxer を呼ばず、video-only 中間物を成果物へ copy して
音声トラックのない「映像のみ」とする。この場合は音声 presence と A/V 終端差を検査対象にしない。
低レベル CLI の `--audio <path>` は書き出し前に音声ストリームを probe し、無ければ carrier を作らず
exit code 2 で中止する。edit.json の音声を混ぜる製品経路は §11 の `render-cut --engine gpu` である。

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
    "mux": "incremental-mp4",
    "video_reencode": false
  },
  "audio": {
    "mode": "copy",
    "source": "cut-audio.mp4",
    "source_has_audio": true
  },
  "gpu": {
    "platform": "win32",
    "chromium": "140.0.0.0",
    "renderer": { "vendor": "NVIDIA Corporation", "renderer": "ANGLE (NVIDIA GeForce RTX)" },
    "encoder_support": { "prefer-hardware": true, "prefer-software": false },
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

`audio.mode` は `copy`（明示ソースの音声を copy）、`silent-carrier`（明示ソースに音声が無く §5 の
carrier を付与）、`none`（音声ソース未指定・映像のみ）のいずれかである。`source` は basename だけを
記録し、絶対パスは残さない。`none` の `source` と `source_has_audio` はともに `null` とする。

`gpu.eligibility[]` は overlay/caption/edit の id、4 分類、理由、検出条件を省略せず並べる。memory は
OSR receipt と同じ warning/hard-stop 語彙を使う。`--engine osr` と `--engine gpu` は receipt 以外の
最終成果物パス・命名と `.akari/render.json` の置き場を共有する。

`gpu.platform` と `gpu.chromium` は Electron main process の実行環境、`gpu.renderer` は renderer process
で `WEBGL_debug_renderer_info` から取得した vendor / renderer（取得不能なら `null`）を記録する。
`gpu.encoder_support` は製品と同じ H.264 config の `hardwareAcceleration` だけを差し替えた
`prefer-hardware` / `prefer-software` の対応可否を記録し、取得不能なら `null` とする。WebCodecs は
実際に使われた encoder 実装を露出しないため、「hardware encoder が使われた」という主張は
`encoder_support` と書き出し速度を組み合わせて裏取りする。

## 8. v0 / v2 の限界

- 語矩形で表せない演出、色補間と幾何変形が同居する cue、縦書きの語単位字幕は glyph atlas 等の次段が必要。
- 動的自由 HTML は OSR または事前ベイクが必要。
- 全 platform で launcher tier 1 / 2 があれば `auto` で適格時に GPU、不適格時に OSR を使う。
- 長尺の区間並列、複数 process 並列は非対応。
- ~~インストール済みデスクトップアプリ経由（launcher tier 1）の GPU 書き出しは未配線~~ **2026-08-29 解消**: shell の `electron-entry.js` が `--akari-main packages/gpu-export/src/electron-main.mjs` を受け、`buildElectronArguments` が tier 1 にそれを渡す（osr 契約 §6）。`resolveGpuLauncher` の fail-closed（allowDesktop 既定 false）は v0.1.28 で解除。以下は v0.1.26〜v0.1.27 の記録: （v0.1.25 で判明）。shell の `--render` は OSR ランタイムしか読まず、`buildElectronArguments` は tier 2 にしか mainScript を渡さない。v0.1.26 から `resolveGpuLauncher` は tier 1 を候補から外す（fail-closed）: `auto` は OSR へ（provenance に `engine_fallback` と理由）、`--engine gpu` 明示は拒否。tier 1 の配線（shell contribution に GPU ランタイム選択を足す）は別票。

## 8.1 プラットフォーム

| platform | `--engine gpu` | `--engine auto` | launcher |
|---|---|---|---|
| macOS | 明示利用可 | 適格なら GPU、不適格なら OSR | tier 1 / 2（ただし tier 1 は現状未配線で fail-closed） |
| Windows | 明示利用可 | 適格なら GPU、不適格なら OSR | tier 1 / 2（同上）。ハイブリッド GPU 機では子プロセス（tier 1 / 2 とも）が既定で iGPU に載り `prefer-hardware` が解像度に関係なく unsupported になる（2026-09-01 実測）ため、launcher が GPU 出口の launch で Windows のアプリ別 GPU 設定（HKCU `UserGpuPreferences`・`GpuPreference=2;`）を spawn 直前に一時上書きし終了後に復元する（`auto` は GPU 出口だけ・OSR 出口は `force` のみ・2026-09-02 改訂）（osr 契約 §6 / §11.7・`AKARI_EXPORT_GPU_PREFERENCE=auto|off|force` / `render-cut --gpu-preference`）。下の注記も参照 |
| Linux | 明示利用可 | 適格なら GPU、不適格なら OSR | tier 1 / 2（同上） |

**Windows の注記（2026-09-01 追記・2026-09-02 改訂）**: 一時上書きの判定表・順序・sidecar・記録は osr 契約 §11.7 裁定 1〜7 を正とする。`auto` の一時上書きは GPU 出口（`launchGpuExport` が `exit: "gpu"` を渡す launch）だけに適用し、OSR 出口は `force` のときだけ書く（裁定 1 改訂・根拠は §11.7）。receipt の `provenance.gpu_preference` に `exit` が載る。GPU 出口固有の追加は次の 3 点。
(a) page-runtime の `WebCodecs H.264 config is unsupported` throw は `renderer` と `encoder_support` を error に添え（`gpuDiagnostics` プロパティ + メッセージ末尾の ` renderer=<UNMASKED_RENDERER>` と marker）、`electron-main.mjs` の failed run.json は `gpu.renderer` / `gpu.encoder_support` をそれで埋める（固定 `null` にしない）。
(b) `exportWithGpu` の `attachGpuFailureContext` は run.json の `error` が同文を含むときだけ `error.message` を日本語 1 行（`describeHardwareEncoderFailure`・1 行・改行なし・末尾に `（原因: <元の英語エラー 1 行>）`）に置き換え、`error.originalMessage` に元を保持する。文面は run.json の `gpu.devices` を `summarizeGpuAdapters` で要約した `hybrid / active_is_high_performance` と、launcher の `gpuPreference.reason / applied` で分岐する: hybrid・iGPU・`user-preference-respected` → 省電力固定の説明 + `force` の案内 / hybrid・iGPU・`policy-off` → `auto` の案内 / hybrid・iGPU・`applied` → 書いたのに反映されない旨 + 設定アプリの案内 / dGPU なのに unsupported → ドライバ更新か `--engine osr` / hybrid でない → `--engine osr` / devices null → renderer 文字列だけで同旨 + `（GPU 情報は取得できませんでした）`。render-cut は `render-cut execution error: <この 1 行>` を stderr 最終行に出す。
(c) hardware 不可のときの OSR 自動フォールバックは増やさない（§12.3 の fail-closed を維持）。

npm Electron の tier 2 は `node_modules/electron/path.txt` を必須とする。値は win32 が
`electron.exe`、darwin が `Electron.app/Contents/MacOS/Electron`、linux が `electron` である。
インストール済みアプリの tier 1 を配布する場合は shell の `extraResources` に
`packages/gpu-export` が同梱されていることを前提とする。ただし現行 tier 1 は
`GPU_DESKTOP_TIER_UNWIRED_REASON` のとおり候補から外し、誤って OSR を GPU receipt として記録しない。

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

CSS 3D は次の 3 群に分けて判定する。

- 幾何（`perspective` / `perspective-origin` / `rotateX/Y/3d` / `matrix3d` / 非ゼロの
  `translateZ/3d`）は `dom` 適格とする。2026-09-03 の 8 fixture × 5 時刻の実測では最大外接矩形内 MAD
  0.5336（2D ノイズ床 0.1929、予算 1.0）だった。次の例外を維持する。
  **例外（2026-08-31・issue #34）**: Z 成分がリテラル 0 の `translateZ(0)` / `translate3d(x, y, 0)` は
  2D の `translate` と描画結果が同一（実測: 静的スプライトで全コマ YMAX=0）なので 3D として検出しない。
  Z が 0 以外、引数の個数が違う、Z が `var()` / `calc()` 等でリテラルとして読めない場合は 3D 幾何として扱う。
  引数の切り出しは括弧の入れ子を数えるので、`translate3d(var(--x), calc(1px + 2px), 0)` のように X / Y が
  CSS 変数・calc 駆動でも Z のリテラル 0 を読める（オーバーレイ規約は調整値を CSS 変数に出すため自然に現れる形）。
- `backface-visibility: hidden` を伴う CSS 3D は `css-3d-backface-hidden` として fail-closed を維持する。
  2026-09-03 の 8 fixture × 5 時刻の実測では外接矩形内 MAD 13.4318、GPU にだけ現れる画素が最大
  207,679 px であり、裏面除去は転写されなかった。
- `transform-style: preserve-3d` は `dom` 適格とする。ただし GPU 経路の遮蔽順は DOM 順になる。
  子孫の描画域が画面上で交差し、手前の要素が DOM 上で先に描かれる矛盾対を検出した場合は警告するが、
  fail-closed にはしない。

次の条件は fail-closed のまま `degraded` とし、receipt に overlay id、理由、検出条件を全件残す。

- `iframe`、`object`、`embed` の埋め込み context。
- `requestAnimationFrame`、`setTimeout`、`setInterval`、`Date.now`、`performance.now` で自走する時計。
- `video`、`audio`、canvas/宣言型 3D 以外の runtime、JSON 以外の script。
- 絶対 URL と外部 font/image/background resource。`background(-image)` の `url(` 走査は宣言の区切り
  （`;` `}`）に加えて引用符とタグ境界（`"` `'` `<` `>`）で止め、`url(#id)` の同一文書内フラグメント参照は
  外部扱いしない（2026-08-31・issue #33。それまでは末尾に `;` の無いインライン style から後続 SVG の
  `fill="url(#id)"` まで走査が届いて誤検出していた）。
- `drawElementImage` が利用できない実行環境、または device pixel ratio が 1 でない環境。

settle は mount 時に一度だけ決める。`canvas.requestPaint` がある Chromium では rAF 2 回の後に
`requestPaint()` と `paint` event（上限 250 ms）を待つ。API がない Chromium では computed style、
bounding rect、host height を同期読みして layout を確定し、直ちに転写する。採用 policy、API probe、
DOM 層の固定・待機・転写・upload の p50/p95 は receipt の `gpu.domLayer` に記録する。

`--verify-frames` では各 DOM ラン左上の 8×8 sentinel を frame number から決定論的に着色し、転写後
texture の左上 4×4 が期待 RGB の ±8 に一致するかを毎コマ検査する。CSS `mod()` の自己検査に失敗した
環境では JS channel 指定へ切り替え、その mode も記録する。pixel read は
`src/verify-readback.js` に隔離した検証経路だけに許可し、製品経路の読み戻しゼロ契約は変えない。

DOM 層の OSR decode 比較は、animation 開始時刻を含む代表 5 時刻で、(1) overlay 外接矩形内 MAD 1.0 以下、
または (2) 構造一致（全画面 MAD 0.2 以下、かつ片側にだけ現れる画素の合計が外接矩形面積の 0.5% 以下）の
いずれかを要求する。0.5% はアンチエイリアスの差が面積でなく周長に比例して増えることに基づく
（実測: 二段 preserve-3d の構造一致例は片側 193〜273 px = 外接矩形の 0.136〜0.161% で、
外接矩形の周長の約 17%。面が丸ごと出現する不合格例は片側 207,679 px で 3 桁離れている）。
外接矩形の面積が 1,000 px 未満へ退化した時刻（例: 全面が真横を向いて消える瞬間）は (1) を使わず
全画面 MAD 0.2 以下だけで判定する。`gpu.domLayer.preserve3dOrderConflicts` が非空の overlay は
この比較の対象外とし、**警告が出ていること自体**を合格条件とする（下記の既知の限界を承知で通すため）。
sentinel は全要求 frame 一致を必須とする。既知の限界は karaoke の word texture、
自走時計、3D scene の DOM 入場 animation、OSR/legacy に残る `@property` animation の時刻不整合に加え、
`preserve-3d` の子孫が交差すると遮蔽順が DOM 順になることである。検出器は Z 順との矛盾を警告し、receipt の
`gpu.domLayer.preserve3dOrderConflicts` に残す。`backface-visibility: hidden` は転写されないため degraded とする。

決定論には長尺時の既知の限界がある。短い書き出し（実測 450 / 678 / 900 コマ）は 2 走の全コマ SHA と
MP4 SHA が一致した。一方、大きな文字を持つ DOM overlay を多数含む長い書き出し（実測 5400 コマ）では、
1 つの overlay 区間に閉じた 180 コマ前後で文字の縁のアンチエイリアスが走ごとに変わり、全コマ SHA 一致が
確率的に崩れた（MAD 0.0001〜0.0003、差分画素 11〜41 個）。sentinel は全走一致しており 1 コマ遅れではない。
ラスタライズ関連の起動フラグでは解消しなかった。

**検収裁定（2026-08-29・司令塔）**: DOM 層を含む書き出しの HW 決定論 gate は「2 走の全コマ SHA 一致」ではなく
**「全コマの per-frame MAD ≤ 0.001 かつ sentinel 全一致」を一致とみなす**。上記の文字縁アンチエイリアス差（最大 0.0003）は
この範囲内であり不可視・1 コマ遅れでもないため受け入れる。DOM 層を含まない書き出し（エンジン層・静的スプライト・
語単位字幕のみ）は従来どおり SHA 一致を要求する。

（2026-08-28 v1 時点の記述）字幕 cue はページ起動時に 1 枚ずつ SVG へ焼いており、30 cue の焼き込みが
900 コマの書き出しに約 47 秒（約 52 ms/コマ相当）を上乗せした。字幕を含む短い書き出しでは GPU 出口が
OSR より遅く、同じ題材から字幕を外した実測は GPU 19.2 ms/コマ、OSR 40.9 ms/コマだった。

2026-08-29 の #120f で、土台以外のスプライトを種別ごとのインスタンス描画へまとめた。karaoke の
`drawArrays` は字幕の本数によらず 1 コマ 2 回で一定となり、3 cue 同時と字幕なしの追加 GPU 時間は
+23.4 ms/コマから +1.65 ms/コマへ縮小した。毎コマの字幕描画費用という限界は解消し、実素材
`akari-video-pv`（5,999 コマ）では GPU / OSR 7.2〜8.2 倍へ到達した。

（2026-08-29 #120f 時点の記述）残る字幕差は毎コマの合成費用ではなく、cue 採寸と SVG ラスタの起動費用である。実素材 PV の字幕ありは
150.7 秒（25.1 ms/コマ）、字幕なし対照は 88.0 秒（14.7 ms/コマ）で 1.71 倍だった。30 cue の
`akari-project/dynamic` では字幕ラスタが約 47 秒から 9.95 秒へ短縮したが、30 秒級の短い題材では
起動費用の比率が大きく、GPU / OSR は 1.07〜1.14 倍にとどまる。

2026-08-30 の #120h では、実素材 `akari-video-pv`（5,999 コマ・44 cue・88 band / 6 batch）の
receipt `gpu.captionStartup` をラッパーが 5 走実測した。#120f 時点で約 63 秒だった字幕の起動費用
（SVG ラスタ 20.5〜21.3 秒 + cue 採寸 88 variant）は、`captionStartup.totalMs` 2.75〜5.01 秒と
`captionRasterTotalMs` 5.90〜7.34 秒、合計 **8.7〜12.3 秒**になった。代表する 1 走の内訳は、
フォントの base64 符号化 0.66 秒（符号化後 13.6 MB・走に 1 回だけ）、cue 採寸 1.54 秒
（88 stable call / 176 pass / 264 variant・うちフォント待ち 0.75 秒・レイアウト 0.073 秒）、
SVG ラスタ 5.90 秒（SVG 組み立て 0.046 秒、data URL 割り当て 0.52 秒、decode 2.80 秒、
中間 sheet への描画 1.72 秒、band の blit 0.11 秒、テクスチャ登録 0.004 秒）である。

frame loop 中の `stages.captionRasterBatch` は **0 回**で、6 バッチすべてが書き出し開始前に焼き終わる。
frame loop の `stages.captions` は p50 0 ms / p95 0.1 ms である。採寸の使い回しは cue の内容
（出力寸法・CSS 変数・cue の HTML・unit index・CSS 変種列）が完全に一致したときだけ効く。PV の
44 cue は本文がすべて異なるため `reusedStableCalls` は 0 で、88 stable call は 88 distinct key の
ままである。同じ本文を共有する 3 cue の fixture では、6 stable call のうち 4 が使い回され、
distinct key は 2 へ落ちる。採寸が 32 回で収束しない unit は、その unit だけ sprite へ降格し、
receipt の `gpu.captions[].mode = "sprite"` と warning に出して書き出しは完走する（fail-closed にしない）。

速度の絶対値は 2026-08-30 の測定では取れていない。1 分 load < 20 の静かな窓を 40 分 × 3 回待っても
来ず、観測した最小 load は 52 だった。PV は load 77〜421 の下で 250.6〜687.4 秒、同じ高負荷下の
字幕なし対照は 220.4〜785.4 秒で、字幕ありとの差は走ごとの 3 倍以上の load 変動に埋もれ、対照より
速い走もあった。したがって、静かな窓での「PV ≤ 110 秒」「dynamic ≥ 2×（OSR 比）」は未検証である。
参考値として、高負荷下の `akari-project/dynamic` は GPU 71.1〜80.7 秒 / OSR 93.6〜97.8 秒
（1.2〜1.3 倍）で、#120f 時点の 1.07〜1.14 倍からは改善している。RSS の上限は 531〜914 MB
（1 GB 以内）、`--trap-readback` の読み戻しは 0 だった。

## 10. v3 — 宣言型 3D の登場表現

v3 は、宣言型 Three.js scene の HTML 部分にある CSS animation / transition / `@property` を GPU 経路で
扱う。Three.js 自体は従来どおり engine clock の local seconds を
`threeRuntime.render(container, t)` へ直接渡し、scene 内部の animation、動画 texture、ready 判定は
変更しない。登場表現を従来の文法へ解析できる場合は理由 `three-scene-entrance-curve`、解析できない場合は
計算済みスタイルを実測する理由 `three-scene-entrance-sampled` とする。解析不能だけを理由に fail-closed
にはしない。CSS animation のない宣言型 3D は理由 `three-scene-canvas-direct` のままである。

curve モードは従来どおり、対になった `[data-akari-active] .root, [data-no-timeline] .root` selector、
1 本・2 endpoint の keyframe、既知の timing、非負 delay、iteration 1、normal direction、`both` または
`forwards` fill、opacity と 2D translate / scale だけを解析する。overlay の `vars` と
`transform.x / y / scale` を解決し、manifest の `entrance` に絶対値を置く。

```json
{
  "durationSec": 1.1,
  "delaySec": 0.05,
  "timing": { "x1": 0.16, "y1": 1, "x2": 0.3, "y2": 1 },
  "fill": "both",
  "from": { "opacity": 0, "tx": -380, "ty": 140, "sx": 0.817, "sy": 0.817 },
  "to": { "opacity": 1, "tx": 0, "ty": 0, "sx": 0.95, "sy": 0.95 }
}
```

毎コマの意味論は次式を正本とする。delay 前は from、終了後は to とし、opacity / tx / ty / sx / sy の
すべてへ同じ eased progress を線形補間で適用する。

```text
local    = seconds - overlay.start
progress = clamp((local - delaySec) / durationSec, 0, 1)
eased    = timing == linear ? progress : cubicBezierAt(progress, x1, y1, x2, y2)
value    = from + (to - from) * eased
```

`cubicBezierAt` は frame-engine の既存 export を使用する。実素材 3 種を Chrome headless の
`getComputedStyle` と delay 前・登場中 3 点・終了後の 5 時刻で突き合わせた実測差は、translate 最大
0.00043 px、scale 最大 0.000001、opacity 0 だった。検収閾値は translate 0.5 px 以下、opacity 0.005
以下、3D 登場区間の GPU / OSR 外接矩形内 MAD 1.0 以下とする。

sampled モードは overlay sheet が生成した paused WAAPI clone を使い、毎コマ、OSR と同じ合成時刻
`seconds * 1000` を `currentTime` に設定する。`data-akari-active` を更新した後、overlay container から
Three canvas までの各要素について計算済み opacity と transform を読み、transform-origin を含む 2D 行列を
上から順に累積する。opacity は積を clamp する。サンプリングは engine clock の時刻だけの関数であり、
壁時計や rAF の進行へ依存しない。

`@property` を使う断片も `degraded` にはせず sampled として扱う。ただし書き出し用 sheet の WAAPI clone
変換は登録済みカスタムプロパティの keyframe を引き継がないため、そのプロパティ自体は GPU / OSR の
どちらでも補間されず初期値のまま描かれる。同じ keyframe に直接宣言した opacity / transform は補間され、
両エンジンの結果も一致するためパリティは保たれる。カスタムプロパティ補間は sheet 側の別課題である。

累積行列が軸平行な translate / scale だけなら 3D canvas を従来の texture のまま使い、中心基準の
sprite draw state へ変換する。回転またはせん断を含む一般 2D affine は、出力寸法の中間 canvas へ
`setTransform(a,b,c,d,e,f)` で描いてから恒等 draw state で合成する。perspective、実 Z 成分、その他の
3D 行列は理由 `three-entrance-3d-matrix` で `degraded` にする。

sampled 方式 A の対象は、断片 root から Three canvas までの祖先チェーン（両端を含む）である。
このチェーン上の任意の要素にある animation / transition は累積行列へ含める。Three canvas の CSS
ボックスが出力全面と一致しない場合は、軸平行な行列でも中間 canvas 経路を使い、元の位置と寸法を保つ。
canvas 以外の HTML（fallback や装飾）を DOM 層で別描画して合成順を保つ方式 B は本版では未実装である。
祖先チェーン外に animation / transition がある、または保守的な静的走査でチェーン内だけと証明できない
場合は `three-html-animated-descendants` で `degraded` にする。filter / clip-path など他の既存 hard
blocker も従来どおり fail-closed とする。

manifest の各 3D sprite は `entranceMode: "curve" | "sampled" | "none"` を持つ。run payload と receipt の
`gpu.three.overlays[].entrance.mode` は登場表現について `curve` または `sampled` を記録し、
`gpu.three.sampling` は sampled フレームの `count`、`p50`、`p95` ミリ秒を記録する。

## 11. v2 の cut 音声中間物（2026-08-29 追記）

GPU 経路の映像は `edit.sources` をページ側で直接読み、`cut.mp4` の映像を使用しない。そのため
cut 段は `cut-audio.mp4`、尺延長が必要な場合は続けて `cut-audio-tail-padded.mp4` を生成し、
音声ストリームだけを最終 mux へ渡す。両コマンドは `-vn` とし、映像のデコード・フィルタ・
エンコードを行わない。音声の trim、速度、freeze 無音、transition、gap、AAC 48 kHz の意味論は
従来の映像込み cut / tail-pad と同じである。legacy 経路は従来どおり映像込み中間物を使用する。
音声入力は cut ごとに入力側シーク（`-ss` / `-t`）し、cut 頭 0.5 s の先読みガード（AAC の overlap-add 用）を設け、cut 段の費用を素材長に依存させない。

## 12. 採寸不安定の根治・実行時フォールバック・生フレーム dump（2026-08-30 追記）

### 12.1 事実（2026-08-30・capture-v2-engine レーンの実測と司令塔のコード確認）

- 内部 fieldtest 案件（11 秒・1080p・字幕 **3 cue・`words[]` 無し・style 無指定**・HTML オーバーレイ 2・LUT）で、
  §2.1 の採寸が **32 回で収束せず `caption-measure-unstable` で fail-closed** する。`6da9a353` 以前の main でも同じ地点で落ちる既存不良。
  いちばん単純な字幕でも起こるため、原因は karaoke / pop の語矩形ではなく採寸の土台にある可能性が高い（未特定）
- `render-cut.mjs` は `exportWithGpu` の**実行時失敗を捕捉しない**。`engine_fallback` が発火するのは launcher tier 3（Electron 不在）だけで、
  page runtime が fail-closed すると書き出し全体が失敗する。`--engine auto` は事前の適格判定で gpu を選ぶが、採寸の収束は実行時にしか
  分からないため、適格判定では弾けない
- `akari capture --engine auto` は書き出しと同じ関数でエンジンを解決する（capture 契約 §9.2）ので、同じ案件で同じ地点で落ちる。
  `--engine osr` 明示なら通る
- gpu 書き出しには、エンコーダへ渡す直前のフレームを取り出す機構が無い（読み戻しゼロの設計 §4）。osr には `--dump-frames`
  （`raw/frame-N.bgra`）があり、capture 契約 §9.3 の可逆比較は osr でだけ成立している

### 12.2 要求 A — 採寸不安定の原因特定と決定論化

- 収束しなかった試行について、**どの cue のどの値がどれだけ揺れたか**（variant / token / rect の差分）を run.json と receipt に残す
  （現状は attempts の count / p50 / max だけ）。原因は推測で決めず、この差分と再現案件で特定する
- 特定した原因に対して決定論化の手を入れる。**許容差・平均・丸めで揺らぎを隠さない**（§2.1 の原則は不変）。
  候補は実測で選ぶ: レイアウト確定の待ち方（`getBoundingClientRect` 1 回で足りているか・rAF / フォント metrics の遅延）、
  root の挿入位置・サイズの固定、DPR / zoom の固定、など
- 根治できた範囲と、できなかった条件（あれば）を契約に追記できる形で報告する

### 12.3 要求 B — 実行時フォールバック（必須）

- `--engine auto` で gpu の page runtime が **閉じた集合の理由コード**（v0 は `caption-measure-unstable` のみ）で fail-closed したとき、
  render-cut は **osr で再実行**し、`provenance.engine_fallback = { from: "gpu", reason: "<reasonCode>" }` と gpu 側の失敗 run.json への
  参照を receipt に残す。中間物は捨てて osr を最初から回す（部分再利用しない）
- 明示 `--engine gpu` は従来どおり fail-closed（理由を表示して exit ≠ 0）。フォールバックは `auto` だけ
- `akari capture --engine auto` も同じ関数・同じ理由コード集合でフォールバックし、`capture.json.engine.fallback` に記録する
- フォールバック対象外の失敗（デコード不可・Electron クラッシュ等）は従来どおり失敗のまま。集合を広げるときは本契約に追記する

### 12.4 要求 C — gpu 書き出しの生フレーム dump（検証専用）

- `--dump-frames <n,...>` を gpu 書き出しに追加。エンコーダへ渡す直前の `finalCanvas` を読み戻して `raw/frame-N.rgba`（8bit・行順は
  osr の dump と同じ規約で明記）に書く。osr の `--dump-frames` と引数・出力先の形を揃える
- **フラグ無しの製品経路は読み戻しゼロを維持**（`assert-zero-readback` の静的監査と `--trap-readback` の両方が引き続き通ること）。
  dump は `--verify-frames` と同じ検証専用の枠に置く
- capture 契約 §9.3 の可逆比較を gpu でも成立させる: `capture --engine gpu -t N` の PNG ≡ `--dump-frames N` の raw（MAD 0）

### 12.5 受け入れ

- fieldtest 案件（複製）で `render-cut --engine auto` が**完走**する。根治できていれば gpu で、できていなければ osr へのフォールバックで。
  receipt にどちらだったかと理由が残る。`capture --engine auto -t 0 3 6` も同様に完走
- 収束しなかった試行の差分ログが run.json / receipt に出る（フィクスチャで再現できなければ、揺らぎを注入したユニットテストで形を固定）
- `--dump-frames` で取った raw と `capture --engine gpu` の PNG が bit 一致（MAD 0・3 フレーム）
- フォールバックが発火しない既存フィクスチャの mp4 SHA は不変。`assert-zero-readback` PASS・`--trap-readback` 完走
- 明示 `--engine gpu` の fail-closed 挙動と exit code は不変（テストで固定）

### 12.6 実装レーンの実測による追記（2026-08-30・検収後）

- **原因（確定）**: `captions.mjs` の `.akari-caption__plate` に付く entrance fade（`akari-caption-fade 180ms ease-out`・
  `translateY(0.18em → 0)` = 既定 38 px で 6.84 px）を、ラスタ側は `settleCss` で停止していたが**採寸 root には当てていなかった**
  （`CAPTION_WORD_FREEZE_CSS` が止めるのは語単位の 6 セレクタのみ）。採寸は生きている transform を任意時点でサンプルしていたため、
  `ease-out` 終端の 0〜0.5 px の残差が毎回違い、許容差ゼロの連続 2 回一致が 32 回でも成立しなかった。#120c r0 の「語矩形 y が
  最大 1.71 px 揺れる」も同じ現象。差分ログの実測: 31 対すべて不一致・揺れたフィールドは `plate.y/bottom` `line[0].y/bottom` の 4 つだけ・
  試行 1→2 で −6.33〜−6.43 px（= 0.18em）
- **原則（§2.1 に追加）**: **採寸 root に適用する CSS は、ラスタ band に適用する CSS と同一集合でなければならない**
  （採寸 = ラスタされる幾何、を構成上保証する）。実装は `measureCss = CAPTION_WORD_FREEZE_CSS + settleCss` で採寸・probe・両 variant を揃え、
  静的テスト「caption measurement roots are frozen in the same settled state the raster uses」で固定。許容差・丸め・平均は入れていない
- **根治の実測**: fieldtest 案件で `captionMeasureAttempts = {count 3, p50 2, max 2}`（理論下限）・diffs 0・`captionLayoutMaxDeltaPx` 0・
  gpu 2 走 mp4 SHA 一致。§12.1 の「32 回で収束せず」は正確には**高確率で**（base では確率的に収束することもある）
- **32 回の上限**は据え置く。根治後は 2 回で確定するため上限は実質保険。下げるなら揺らぎが残る条件を別途観測してから
- **`--dump-frames` の形**: 行順は上から下で osr と同規約。チャネル順はエンジンが本来読み戻す形式のまま（gpu = RGBA `raw/frame-N.rgba` /
  osr = BGRA `raw/frame-N.bgra`）で拡張子が表す。`--trap-readback` とは相互排他
- **receipt / provenance のキー**: フォールバック時は `provenance.engine = "osr"`・`engine_fallback = { from: "gpu", reason }`・
  **`provenance.gpu_failure_run`**（gpu 失敗 run.json のプロジェクト相対パス）。capture は `capture.json.engine.fallback` に同じ内容
- **capture の parity ガード**: render-cut がフォールバックした receipt（`provenance.engine = "osr"`）に対し、capture 側の解決が `"gpu"` でも
  `engine_fallback.from` が一致すれば parity として受ける（これが無いと capture がフォールバックに到達する前に落ちる。launcher tier 3 由来の
  既存フォールバックにも同じ穴があり同時に塞いだ）
- 判定は構造化された `error.reasonCode` だけを見る（メッセージ文字列一致では発火しない）

### 12.7 §9（#120h の「降格して完走」）との関係 — 司令塔裁定（2026-08-30・r3 合流時）

- **事実**: #120h（§9 追記）は採寸が収束しない unit を **sprite へ降格して書き出しを完走**させる（語アニメが落ちる・receipt の
  `captionStartup.measure.degradedUnits` に計上）。§12.3 は「`auto` は osr へフォールバック / 明示 `gpu` は fail-closed」を要求する。
  r3 の合流はこれを **「実測由来の不安定 = 降格（§9）/ 故障注入 `AKARI_GPU_CAPTION_MEASURE_FAULT` = `caption-measure-unstable` を伝播
  → `auto` は osr フォールバック・明示 `gpu` は fail-closed（§12.3）」** に分けて両方を残した。注入は「復旧不能な採寸失敗の代役」であり、
  降格経路を撃つスイッチではなくなった
- **裁定（v0）**: この分離を**採る**。根治（§12.6）により実測由来の不安定は理論下限 2 回で収束しており、降格経路は保険。
  降格が起きたときは warning と `degradedUnits` で**黙らずに**記録される（§2.1「揺らぎを隠さない」に反しない）
- **次版の候補（別票 D・小）**: `auto` で `degradedUnits > 0` になった走は「近似で完走」より「osr で正確に完走」を選ぶべきかを裁定し、
  採るなら降格を `FALLBACK_REASONS` 相当（例 `caption-measure-degraded`）として `auto` だけ osr へ回す。明示 `gpu` は降格 + warning のまま。
  降格経路を実機で撃つための注入モード（例: 値の接尾辞で降格を選ぶ）も同票で
- 採寸 settle の実装は #120h の **`.akari-measure-root` にスコープした `measureSettleCss`** に一本化（§12.6 の原則を満たし、ページ全体の
  アニメは止めない）。`contentKey` で再利用される安定結果は `cssVariants` を鍵に含むため必ず settled 状態で測ったもの（実機確認済み）
