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
| `same` | はい | 静的 HTML または対応済み字幕。起動時に 1 回だけスプライト化する |
| `three` | はい | JSON の宣言型 3D scene と描画先 canvas を持つ overlay。毎コマ Three.js canvas を更新する |
| `degraded` | いいえ | raster 自体は可能でも live DOM と同じ時間変化を保証できない |
| `unsupported` | いいえ | v0 の表現範囲外であり、正しい完成画を生成できない |

自由 HTML は、絶対 URL、外部 font/image/background、runtime script、iframe/object/embed、canvas/video、
CSS animation/transition/keyframes、filter/mask/clip-path 等を検出する。条件がない静的 HTML だけを
`same` とする。例外として、検出条件が `three-or-canvas-runtime` だけで、
`<script type="application/json" data-akari-3d-scene>` 宣言を属性順にかかわらずちょうど 1 個持ち、
それ以外の script と video を持たない宣言型 3D は `three` とする。3D の描画先である canvas は許可する。

字幕は cue ごとに 1 回 rasterize し、出現・loop・消失を解析的な opacity と中心基準 affine 変換で
再現する。次は v0 で `unsupported` とする。

- `words[]` を持つ karaoke、pop、reveal、reveal-word 等の語単位表示。
- `emphasis_words`。
- 未知の motion、および clip-path を使う push/typewriter/wipe/glitch。
- `transform-origin: top center` を必要とする swing。

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

## 8. v0 の限界

- karaoke、語単位 style、`emphasis_words` は GPU-native glyph/word texture 実装まで非対応。
- 動的自由 HTML は OSR または事前ベイクが必要。
- Windows の hardware H.264 encoder は v0 の提供対象外。
- 長尺の区間並列、複数 process 並列は非対応。
