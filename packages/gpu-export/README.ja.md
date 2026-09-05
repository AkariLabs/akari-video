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

埋め込み context、JavaScript の自走時計、media element、runtime script、外部 resource、および
`backface-visibility: hidden` を伴う CSS 3D は fail-closed です。CSS 3D 幾何は
`transform-style: preserve-3d` を含めて適格ですが、GPU 経路での preserve-3d の遮蔽順は DOM 順です。
authoring 規約として、その子孫同士を重ねてはいけません。画面上の重なりと Z 順が矛盾すると検出器が警告し、
receipt に記録します。karaoke などの語単位字幕と強調語は v1 でも対象外です。

### 語単位字幕（v2）

karaoke、pop、reveal、reveal-word と対応済み `emphasis_words` は GPU-native です。字幕 unit は
最大 2 状態だけラスタライズし、正本の字幕 DOM から採寸した語矩形により、毎コマの色補間、
表示、アフィン変形を駆動します。karaoke は左から右へのワイプではなく、DOM と同じ語全体の色補間です。
receipt には `sprite` / `words-native` と unit・語・ラスタ・タイル数、2 状態のレイアウト差を記録します。
さらに `gpu.captionStartup` に `totalMs`、`fontEncodeMs`、`fontBase64Bytes` と詳細な `measure.*`・
`raster.*` の起動時間および件数を記録します。

ラスタ texture は出力幅を維持したまま字幕帯だけを縦方向に crop します。開始時刻順の最大 8 unit /
バンド高 4096 px のバッチを、書き出し開始前に一括ラスタします。各バッチは data URL を 1 回だけ
中間 sheet canvas へ decode し、そこから band を blit します。256 MB の
`CAPTION_PREFETCH_MAX_BYTES` 予算を超えるバッチだけが frame loop 中の遅延ラスタに残ります。
variant CSS はバンド単位にスコープし、埋め込み font は SVG 内 1 本にします。GPU texture は従来どおり
unit 終了時に解放します。canvas / WebGL を汚染する Blob・HTTP URL は使用しません。

安定した採寸結果は、正規化した内容キー（出力幅・高さ、cue の CSS 変数、cue の HTML、unit index、
順序を保った CSS 変種列）が完全に一致するときだけ使い回します。`document.fonts.check` の結果も
キャッシュします。採寸ルートにはラスタと同じ settle CSS を `.akari-measure-root` にスコープして適用し、
採寸が壁時計上の animation 進行に依存しないようにします。採寸は厳密一致が 2 回続くまで最大 32 回行い、
収束しない unit はその unit だけ sprite へ降格します。書き出しは fail-closed にせず完走し、receipt の
`gpu.captions[].mode = "sprite"` と warning に記録します。

karaoke の色変化と幾何 emphasis の混在、縦書きの語単位字幕、未知の word style は引き続き不適格で、
具体的な理由を付けて fail-closed になります。

### 宣言型 3D の登場表現（v3）

宣言型 Three.js scene は、transition、`@property`、複数 animation、中間 keyframe、alternate、
rotate、skew を使う CSS 登場表現も GPU 経路で扱えます。従来の 2 endpoint 文法は `curve` の高速経路に
残し、それ以外で断片 root から Three canvas までの祖先チェーン内に閉じた登場表現は `sampled` 経路へ
送ります。paused WAAPI を合成時刻へ seek し、overlay container から Three canvas までの計算済み
opacity と 2D transform をアクティブな毎コマで実測します。canvas が出力全面なら軸平行 transform は
sprite draw state、回転・せん断・非全画面 canvas は中間 2D canvas で処理します。Three.js 自体は
従来どおりエンジンの local clock で動きます。

登録済みカスタムプロパティの keyframe も sampled 経路へ入りますが、現状の書き出し用 sheet の WAAPI
clone では GPU / OSR ともプロパティが初期値のままです。直接宣言した opacity / transform は補間され、
両エンジンのパリティは保たれます。カスタムプロパティ補間は書き出し用 sheet 側の別課題です。

sampled 経路の入口条件は `three-or-canvas-runtime` / `animation-timing` の 2 つです。方式 A が
root→canvas の祖先チェーンだけでは断片を説明できない場合は、方式 B で
`three-scene-sampled-composite` に分類します。Three.js は従来どおり overlay sheet で描画し、毎コマその
canvas を DOM 層コピー内の対応 canvas へ中継し、`[data-akari-3d-fallback]` を隠してから断片全体を
`drawElementImage` で転写します。これにより canvas 前後の DOM 順と z-index を保ち、断片間は track z と
宣言 index の順を維持します。

composite は canvas チェーン内外の CSS 3D 幾何と `advanced-css` を扱います。CSS 3D は DOM 層と同じ判定を
再利用し、深度 transform は通し、preserve-3d の順序競合は警告付きで通し、深度を伴う
`backface-visibility:hidden` だけ `css-3d-backface-hidden` で degraded のままにします。`@property` は
sheet / DOM 間のカスタムプロパティ補間パリティを実測するまで `three-composite-property` で fail-closed です。
`preserve-3d` 要素に Three canvas チェーン上の子と、深度 transform を持つチェーン外の子が同居する composite は
`three-composite-preserve-3d-siblings` で fail-closed にします。GPU はこれらの兄弟を DOM 順で描くため OSR と
絵が変わっていました（2026-09-04 実測: 外接矩形 MAD 5.0082。OSR では z>0 の兄弟だけが canvas の前）。
`preserve3dOrderConflicts` を兄弟対まで広げれば次ラウンドで再解禁できます。親子対は従来どおり警告付きで通します
（実測パリティ 0.6374）。
composite の入口外条件は `three-sampled-condition:<条件名>` を報告します。方式 A の
`three-sampled-chain-css:<プロパティ>` ガードは残します。manifest は `entranceMode`、receipt は
`curve` / `sampled` / `composite` mode、sampling 費用、composite の DOM 要素数と canvas 中継・DOM 層費用の
p50/p95 を記録します。CSS animation のない scene は他の条件を持たない場合は従来どおり `three-scene-canvas-direct` とし、`advanced-css` や CSS 3D 幾何を伴う場合は composite 経路（`three-scene-sampled-composite`）で断片全体を転写します。

`render-cut --engine auto` は macOS / Windows で GPU を候補にし、プロジェクト全体が適格なら GPU、
不適格なら OSR を使います。Linux の `auto` は legacy のままで、`--engine gpu` を明示した場合だけ
GPU を評価します。明示指定は fail-closed で、全ての不適格理由または launcher の理由を表示します。

DOM 層は `--enable-features=CanvasDrawElement`、`--disable-gpu-vsync`、
`--disable-frame-rate-limit` の 3 フラグで起動します。450 / 678 / 900 コマの書き出しは 2 走の全コマ SHA と
MP4 SHA が一致しましたが、大きな文字 overlay を多数含む 5,400 コマでは、1 overlay の約 180 コマで
アンチエイリアスが確率的に変化しました（MAD 0.0001〜0.0003、差分画素 11〜41 個）。sentinel は全て一致し、
ラスタライズ関連フラグでも揺れは解消しませんでした。

出力解像度が物理ディスプレイより大きい場合（例: 1920×1080 の画面で 3840×2160 を書き出す）、OS は
非表示の `BrowserWindow` をディスプレイに切り詰めるため、DOM 層 overlay の `vw` / `vh` / `vmin` /
`vmax` が出力ではなく切り詰められた窓に対して解決されてしまいます。Electron main はページ読み込み後に
`innerWidth` / `innerHeight` / `devicePixelRatio` を実測し、要求した出力寸法と一致しなければ
`webContents.enableDeviceEmulation` で viewport を出力解像度へ固定して再実測します。それでも固定
できない環境は fail-closed で失敗し、エラーに requested / measured / primary display の寸法を含めます。
run.json と receipt には `viewport: { requested, measured, emulated, display }` を記録します。

毎コマの合成は土台 1 draw と、連続するスプライト種別ごとのインスタンス draw になり、字幕・DOM 層・
3D スプライトの本数が増えても draw 呼び出し回数は増えません。字幕 3 cue 同時では、字幕なしに対する
追加 GPU 時間が +1.65 ms/コマまで縮小し、`drawArrays` の合計 GPU 時間は字幕あり 3.12 ms/コマ、
字幕なし 1.47 ms/コマでした。

5,999 コマの実素材 PV（44 cue・88 band・6 batch）では、#120h の 5 走で字幕起動費用の合計が
8.7〜12.3 秒でした。内訳は `captionStartup.totalMs` 2.75〜5.01 秒と
`captionRasterTotalMs` 5.90〜7.34 秒です。6 バッチすべてが書き出し開始前に完了したため、frame loop の
`captionRasterBatch` stage は 0 回、`stages.captions` は p50 0 ms / p95 0.1 ms でした。静かな負荷での
絶対速度は未検証です。2026-08-30 の測定では必要な 1 分 load < 20 を一度も観測できませんでした。
高負荷下の dynamic fixture は GPU 71.1〜80.7 秒 / OSR 93.6〜97.8 秒（1.2〜1.3 倍）、RSS は
531〜914 MB 以内で、`--trap-readback` の読み戻しは 0 でした。

書き出しは全 Electron プロセスの working set を 10 秒ごとに採り、OSR と同じメモリ予算
（`packages/osr-export/src/memory.mjs`）を使います。1080p 基準で GPU プロファイルは警戒 768 MiB / hard stop
1,024 MiB（`--soft` は 1,536 / 2,048 MiB）です。既定の hard stop は「解像度スケール + 物理メモリ 25% 下限 / 50% 上限」で
決まります。基準値は出力ピクセル数が 1080p を超える比で増え（4K = 4 倍）、hard stop は物理メモリの 25% を下回らず
（16 GiB 機なら 720p / 1080p 出力でも 4,096 MiB。4K HEVC 長尺素材のような入力の大きさで、出力解像度に関係なく RSS が
膨らむため — issue #28。下限が効いたときの warning は hard stop の 75%）、物理メモリの 50% を超えません。
`AKARI_OSR_MEMORY_WARN_MIB` / `AKARI_OSR_MEMORY_HARD_STOP_MIB` は絶対値の上書きで、スケールも下限 / 上限も受けません。
run.json と receipt には `memory.budget_scale`、`machine_floor`、`machine_capped`、`total_memory_bytes` を記録します。

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

### ハイブリッド GPU のノート PC（Intel iGPU + NVIDIA / AMD dGPU）

事実（2026-09-01・RTX 5060 Laptop + Intel UHD 機・Electron 39 で実測）: Windows は書き出しの子プロセス
（npm の `electron.exe` = tier 2 も、インストール済み `AKARI Video.exe` = tier 1 も）を既定で省電力側の iGPU に
載せ、WebCodecs `prefer-hardware` が必要とする Media Foundation の H.264 エンコーダは解像度に関係なく使えません
（4K / 1080p とも `unsupported`）。Chromium のスイッチ（`--force_high_performance_gpu` / `--use-adapter-luid`）は
ANGLE / WebGL を dGPU に移すだけで、エンコーダは iGPU 側のままです。効くのは Windows のアプリ別 GPU 設定
（`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`・値名 = exe のフルパス・データ `GpuPreference=2;`）だけで、
これはプロセス生成時に評価されます。

そこで launcher（`packages/osr-export/src/gpu-preference.mjs`・GPU / OSR 両出口で共通）は、`spawn` の直前に書き出し
実行ファイルの値を書き、子プロセスの終了後（exit code に関わらず・spawn 自体の失敗時も）に元へ戻します — 値が無かったなら
削除、あったなら元の値を書き戻します。再起動も管理者権限も不要で、何も残らないのでアプリ本体の GPU 割り当ては変わりません。
既定の `auto` で書くのは **GPU 出口だけ**（`--engine gpu`・GPU ランタイム経由の capture）です。OSR 出口は ffmpeg で符号化するので dGPU の利点が無く、
RTX 上では frame 0 の offscreen paint が空になる走行がある（現行コード 4 走中 1 敗・pre-T5 コード 4 走中 3 敗・iGPU では 0）ため、`force` を
指定しない限り既定の GPU のまま（`reason: not-gpu-exit`）です。
レジストリを書く前に sidecar `<AKARI_HOME または ~/.akari>/gpu-preference-override.json`
（`{ version, executable, previous, written_at }`）を書き、復元後に削除します。途中で親プロセスが死んだ場合は次回の
書き出しが先に sidecar から復元します（`recovered_stale: true`）。判断は receipt の `provenance.gpu_preference`
（`policy / exit / applied / previous / restored / reason / recovered_stale`）に、子プロセスが実際に載った GPU は run.json の
`gpu.devices`（`app.getGPUInfo("complete")` の `vendor_id / device_id / device_string / active / gpu_preference`・3 秒で打ち切り）に残ります。

| 設定 | 値 | 効果 |
|---|---|---|
| `AKARI_EXPORT_GPU_PREFERENCE` / `render-cut --gpu-preference` | `auto`（既定） | GPU 出口だけ。実行ファイルにアプリ別の値が無いときだけ `GpuPreference=2;` を書く。利用者が Windows の「グラフィックスの設定」で固定した値（省電力 = `GpuPreference=1;` など）は尊重して触らない（`reason: user-preference-respected`）。OSR 出口は skip（`reason: not-gpu-exit`）。 |
| | `off` | レジストリに触らない（`reason: policy-off`）。 |
| | `force` | 固定値があっても `GpuPreference=2;` を書き、終了後に固定値へ戻す。両出口に効く（OSR 出口を dGPU に載せる唯一の手段）。 |
| `AKARI_EXPORT_ALLOW_DESKTOP=0` | | 開発用の脱出口。インストール済みアプリ（tier 1）を候補から外し、リポジトリ側のランタイムを npm の `electron.exe`（tier 2）で走らせる。明示引数 `allowDesktop` が env より優先。 |

macOS / Linux（`reason: platform`）と `--soft`（`reason: soft`）では何もしません。

失敗文の読み方: それでもハードウェアエンコーダが使えないとき、render-cut は stderr の最終行に日本語 1 行
（`render-cut execution error: ...`）を出します。どの GPU に載ったか・なぜ切り替えなかったか・次に何をするかを述べ、
末尾に元の英語エラーを添えます（`（原因: WebCodecs H.264 config is unsupported: ... renderer=<UNMASKED_RENDERER>）`）。

- `内蔵 GPU（<iGPU>）で動作しています ... 省電力に固定されているため自動切り替えしませんでした` — 利用者が省電力に固定している。「グラフィックスの設定」で変更するか `--gpu-preference force` で再実行。
- `... 高パフォーマンス GPU（<dGPU>）への自動切り替えが off です` — `AKARI_EXPORT_GPU_PREFERENCE=auto` で再実行。
- `GPU 設定（<実行ファイル>）を書き込みましたが反映されませんでした` — 値は書けたが Windows が iGPU を選んだ。「グラフィックスの設定」でその実行ファイルを高パフォーマンスに。
- `高パフォーマンス GPU（<dGPU>）で動作していますが ... 応答しません` — dGPU に載ったがエンコーダが応答しない。ドライバ更新か `--engine osr`。
- `この GPU（<adapter>）にはハードウェア H.264 エンコーダがありません` — ハイブリッド機ではない。`--engine osr` で再実行（`app.getGPUInfo` が取れなかったときは `GPU 情報は取得できませんでした` が付く）。

失敗した run は `.akari/gpu-run-failed.json` に `gpu.renderer` / `gpu.encoder_support` / `gpu.devices` 付きで残ります。

## CLI（`akari-gpu-export`）

低レベル CLI は、適格なプロジェクト 1 件を直接書き出します。`--audio` 未指定時は音声トラックのない
映像のみの MP4 を書き出し、その選択を stderr に表示します。`--audio <path>` 指定時は、書き出し前に
ファイルの実在と音声ストリームの有無を確認し、その音声ストリームを最終 MP4 へ copy します。ファイルが
無い場合または音声ストリームが無い場合は、無音トラックを作らず、出力作成前に exit code 2 で終了します。

```sh
node packages/gpu-export/bin/akari-gpu-export.mjs <project-dir> --out <output.mp4> --duration <seconds> [options]
```

| フラグ | 説明 |
|---|---|
| `--out <path>` | 出力 MP4 のパス（必須）。 |
| `--fps <number>` | フレームレート。既定は 30。 |
| `--width <pixels>` | 出力幅。既定は 1920。 |
| `--height <pixels>` | 出力高さ。既定は 1080。 |
| `--duration <seconds>` | 出力尺（必須）。 |
| `--frames <count>` | 出力フレーム数。既定は `duration × fps`。 |
| `--queue-depth <count>` | エンコードキュー深度。既定は 4。 |
| `--quality <name>` | 品質プリセット。既定は `high`。 |
| `--bitrate <bps>` | 映像ビットレートの明示値。 |
| `--audio <path>` | copy する音声ストリームのソース。 |
| `--soft` | software encoder preference を要求。 |
| `--trap-readback` | 製品経路の pixel readback を拒否。 |
| `--verify-frames` | 検証専用の生フレーム hash を有効化。 |
| `--help`, `-h` | usage を表示。 |

| exit code | 意味 |
|---|---|
| `0` | 書き出しまたは help が正常終了。 |
| `1` | 書き出し失敗。 |
| `2` | 引数または入力の前提条件が不正。 |

製品経路は `render-cut --engine gpu` です。`edit.json` で宣言した音声を先に混ぜてから GPU 書き出しを
呼び出します。低レベルの `akari-gpu-export` CLI は `edit.json` の音声を読み取り・合成しません。

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

宣言型 `data-akari-vgpu-scene` は同梱 vgpu 0.4.0 の WebGPU ランタイムで描き、描画直後の canvas を GPU 合成へ渡す。v0 は pure な fragment パス、先行パスの texture 入力、CSS `--vgpu-*` ツマミに対応する。ライブプレビューは辺あたり半解像度、GPU 書き出しは等倍で、配置と時刻を共有する。WebGPU の probe・device 障害は `auto` でも失敗として伝播し OSR へ落とさない。receipt の `gpu.vgpu` は使用時だけ追加する。詳しくは [vgpu v0 契約](../../docs/contract-2026-09-06-vgpu-layer-v0.md)。
