# ページ全体 OSR 書き出し v0 契約

## 1. 適用範囲

この契約は `render-cut --engine osr` が生成する映像ページと、そのページを Electron オフスクリーン描画で駆動するプロトコルを定める。

**2026-08-28 改訂:** `--engine` の既定は `auto` とし、次のように解決する。従来経路へ戻す場合は
プラットフォームを問わず `--engine legacy` を明示する。

| platform | `auto` の解決 | 備考 |
|---|---|---|
| darwin | `osr` | v2 を既定とする |
| win32 | 適格なら `gpu`、不適格なら `osr` | GPU / OSR launcher が利用不能なら順に `legacy` へフォールバック |
| linux | `legacy` | OSR は opt-in |

`.akari/render.json` の provenance は、指定値を `engine_requested`、解決後の実走値を `engine` に
記録する。OSR launcher が tier 3 へフォールバックした場合、`engine` は `legacy` とし、
`engine_fallback: { from: "osr", reason: <launcher.reason> }` を追加する。

## 2. ページ契約

ページは出力幅 `W`、映像高 `H` に検証用1行を加えた `W × (H + 1)` で構成する。映像領域の重ね順は下から次の4層である。

1. frame-engine canvas。cuts、layers、transition、matte、LUTを評価する。
2. `captions.json` から生成したDOM字幕。
3. `edit.json` の自由HTML。
4. 自由HTML内のThree.js canvas。

字幕、自由HTML、3Dは render-cut と同じ overlay sheet 生成器により、透明な同一オリジン iframe として canvas 上へ置く。無効なトラックは最初からDOMへ入れず、活性区間ごとのDOM再構築は行わない。

ページは次のAPIを公開する。

- `window.__akariReady`: フォント、画像、動画、3D、frame-engineのprime完了を表すPromise。
- `window.__akariSeek(seconds, frameNumber)`: frame-engine評価、overlay sheetのシーク、スタンプ更新、2回の`requestAnimationFrame`待機を順に完了する。
- `window.__akariSettle()`: 検証不一致時に2回の`requestAnimationFrame`を進める。

CSS animationはpauseし、`currentTime`を合成時刻へ設定する。Three.jsは対象区間のローカル時刻で描画する。動画要素は提示フレームの確定まで待つ。`frameNumber`はmainから明示的に渡し、秒から再計算しない。

## 3. スタンプ行

最下1行はフレーム番号 `n mod 65536` を次で符号化する。

```text
R = n & 255
G = (n >> 8) & 255
B = 0x55
A = 255
```

BGRA bitmapでは `[0x55, G, R, 255]` となる。左端、中央、右端の3画素を復号し、期待番号との全点一致を要求する。確認後、ffmpegへ渡す前に `buffer.subarray(0, W * H * 4)` で最下行を除く。

`--verify stamp|hash|off` を持ち、既定は `stamp` とする。`hash` は直前の映像領域と同じSHA-256ならsettle後に再取得し、静止画で上限へ達した場合は曖昧件数を記録して受理する。`off` は比較計測用である。通常書き出しではverifyを無効にしない。

## 4. 駆動プロトコル

各コマは次の順で処理する。

```text
seek → ready → invalidate → paint → verify → write
```

`paint`が既定10秒以内に届かなければ失敗として記録する。bitmapは必ず `W × (H + 1)` と照合する。不一致時はsettleして再度`invalidate`し、最大8回で停止する。

映像領域のBGRAは深さ3を既定とするbounded queueへ渡す。ffmpeg stdinの`write()`がfalseなら必ず`drain`を待つ。無制限のpre-bufferは禁止する。v0は先頭から末尾まで連番1 workerで評価する。

`run.json` はseek、paint、toBitmap、verify、writeのp50/p95、1000コマ区切りmedian、先頭と末尾のdriftRatio、paint timeout、verify retry、verify前delta histogram、backpressure、メモリ、ffprobe結果を記録する。

## 5. LUT

`output.look` のLUTはframe-engine canvas内のsampler3Dで適用する。ページ全体へCSS filterを掛けない。したがって字幕、自由HTML、3DはLUTの外にあり、映像canvasだけが色変換の対象となる。

## 6. Electronの器

起動は次の3段で解決する。

1. インストール済みAKARI VideoのElectron実行体を`--render`付きで再利用する。
2. npm optionalDependencyの`electron`を使う。`dist`のライセンス2ファイル、version、プラットフォーム実行体が揃うことを検査する。
3. Electronが無ければ警告を出し、現行render-cut経路へフォールバックする。

第1段・第2段とも、実プロセスのコマンドラインに`--force-device-scale-factor=1`、`--force-color-profile=srgb`、background throttling無効化スイッチを渡す。npm Electronではスクリプトパスを`argv[1]`に保ち、その後へChromiumスイッチを置く。ソフト描画時は加えてGPU無効化とSwiftShaderスイッチを渡す。

第1段・第2段とも`--user-data-dir=<run 一時ディレクトリ>/electron-user-data`を渡し、本体アプリの単一インスタンスロック（userData単位）と分離する。これによりアプリ起動中でも書き出せる。子がexit 0で終了して出力を作らなかった場合は、launcherが失敗として扱う。

`--render`は`package.json`の`main`（`electron-entry.js`）がTheiaより前に捕捉する。backend fork・初期ウィンドウ・contribution・単一インスタンスロックを起動せず、`--akari-main`で指定したランタイム（既定はosr-export、gpu-exportも指定可能）へ直行するため、スプラッシュは表示されない。通常起動で`--render`が無い場合は従来どおりTheiaを起動する。

Linux v0は第3段を使用する。将来の差し替え席として、Chrome headlessと`HeadlessExperimental.beginFrame`を使うlauncherを第1段と第2段の間へ追加できるものとする。この契約では実装しない。

## 7. エンコード、音声、照合

ffmpeg入力は `-f rawvideo -pixel_format bgra -video_size WxH -framerate fps -i -` とする。品質とエンコーダはrender-cutの`master|high|standard|light`および`auto|videotoolbox|x264`を使用する。映像は1世代だけH.264へ圧縮し、その後の音声処理とmuxでは映像をcopyする。

ffprobe timeoutは `max(120000, frames × 100)` msとする。尺、フレーム数、解像度をplanと照合する。

## 8. メモリと長尺

- GPU描画の警戒線: 768 MiB / export、hard stop: 1,024 MiB / export（1080p 基準）。
- ソフト描画（SwiftShader）は1080pで1.1 GiB台に達するため、警戒線1,536 MiB / hard stop 2,048 MiBの別枠を使う。
- 出力ピクセル数が 1080p（1920×1080）を超えるときは既定値をその比で増やす（4K = 4 倍、MiB 切り上げ）。
  ただしスケール後の hard stop は物理メモリの 50% を上限とし、超えるときは切り詰めて warning を hard stop の
  75% に置く（`memory.machine_capped` を receipt に残す）。1080p 以下の既定値は機種に関係なく変えない
  （2026-09-01 改訂。4K の係数は予測値で未較正 — 初回の実測 peak で較正する）。
- `AKARI_OSR_MEMORY_WARN_MIB` / `AKARI_OSR_MEMORY_HARD_STOP_MIB`で正の整数MiBへ上書きでき（絶対値・スケールと上限を受けない）、
  適用値はwarning < hard stopを必須とする。hard stop だけを上書きし既定 warning がそれ以上になるときは warning を hard stop の 75% に追従させる。
  同じ変数を GPU 直結出口（gpu-export）も読む。
- 並列予算1 worker = 1 GiBはGPU前提の値である。v0のworker数は1。
- 10秒ごとにRSSを記録し、ウィンドウ破棄後も採る。
- 固定Nコマごとのページ再生成は行わない。再生成を許すのはページ境界、renderer crash、watchdog回復時だけである。

非連番seekは描画履歴が変わり得るため、チャンク分割・並列化はbyte再現モードと両立しない。将来導入する場合は先頭からのwarm-up履歴または完成画の別検収を必要とする。

## 9. 検収

完成画の検収は[エンジン v2 パリティ契約](./contract-2026-08-02-preview-parity.md) §4 に一本化する。
frame-engine は golden の全点 `diff 0`、OSR は本節のソフト描画 2 走・全コマ SHA-256 一致を必須とし、
GPU は同一マシン一致率を診断値として記録するが byte-exact を合否条件にはしない。

CIはソフト描画の連番2走について全コマSHA-256一致を要求する。製品はGPUを既定とし、同一マシン2走の一致率、`differingPixels`、`maxDelta`を診断値として記録する。GPUのbyte-exactは合否条件にしない。差分調査はH.264を再デコードした画像ではなく、捕捉時のraw BGRAを使用する。

legacyとの比較は字幕、自由HTML、3Dの各指定時刻についてMADと`differingPixels`を記録する。

## 10. 使用しない中間規律

OSR経路では次を使用しない。

- アルファ付き中間動画。
- PNG連番。
- ffmpeg overlay。
- 二重の映像エンコード。
- 3Dの別キャプチャ。
- 字幕の活性区間ごとのDOM再構築。
- 静止コマの重複除去。
- 固定Nコマごとのページ再生成。

## 11. 既知の限界

### 11.1 Bフレーム素材の並べ替え遅延（2026-08-28 改訂・根治済み）

負の DTS で始まる B フレーム素材の並べ替え遅延は、main `b30057de` で
`elst.media_time` を補正して根治した。`has_b_frames=2` の素材でも、提示時刻を edit list の
media time に合わせて評価するため、従来の一定 2 コマ手前になるずれは残らない。

### 11.2 legacyとの全画面画素差

同じraw BGRAを比較した場合、ffmpegが未タグ素材へ既定で使うbt601換算に対してMAD 9.28 / maxDelta 155、bt709換算に対してMAD 0.886であった。残差はクロマ補間による。エンジンは`bt709-limited`で合成する。
**G3 裁定（2026-08-28）:** v2 の `bt709-limited` を正とし、legacy の bt601 換算側を近似として扱う。

ベースを単色にしたfixtureでlegacyとOSRの最終MP4を比較すると、MAD 0.019〜0.345 / maxDelta 7〜78であった。字幕・自由HTML・3Dの描画は一致し、全画面差の主因はベース映像のYUV→RGB変換である。オーバーレイ層の突き合わせは単色ベースで行う。

### 11.3 ソフト描画の前提（2026-08-28 追記）

ソフト描画（`AKARI_OSR_SOFT=1`）は Electron 同梱 `libffmpeg.dylib` に H.264 デコーダが含まれていることを前提とする。`apps/shell` のビルドは `@theia/ffmpeg` によって非プロプライエタリ版へ差し替えるため、ビルド済みの作業ツリーではソフト描画の `VideoDecoder.configure` が全指定で失敗する（GPU 描画は VideoToolbox を使うので影響しない）。ソフト描画の diff 0 条件はこの前提のもとでのみ成立する。判定は `libffmpeg.dylib` に `H264 Decoder` 文字列があるかで行う（`isConfigSupported()` は差し替え版でも true を返すため当てにならない）。

### 11.4 アプリ起動中の第1段（2026-08-28 根治）

v0.1.24以前はTheiaの`singleInstance`により、AKARI Videoデスクトップアプリの起動中に第1段を開始すると、子プロセスがexit 0・無出力で終了していた。launcherが出力を検査しなかったため、後続処理ではこの失敗がffmpegのENOENTに化けていた。runごとにuserDataを分離し、exit 0でも出力が無い場合を失敗として扱うことで根治した。Windowsのelectron-builder NSIS per-user既定導入先は`%LOCALAPPDATA%\Programs\@akari-videoshell`である。

v0.1.25では、contribution方式がランタイムの同梱漏れに遭遇すると、起動途中の`app.exit(1)`がSIGTRAP / Windowsの`0x80000003`に化けた。同梱が揃っていても、Theiaの`window-all-closed`から始まるquitとOSRランタイムのウィンドウ生成が競合し得る構造だった。2026-08-29に`electron-entry.js`方式へ移行し、`--render`をTheia起動前に捕捉してこの競合を除去した。

### 11.5 インストール済みアプリ経由の第 1 段は起動処理と競合して落ちる（2026-08-29 追記）

v0.1.26 の実ビルド（署名有効・未改変）で実証: インストール済みの AKARI Video を `--render` 付きで起動すると、
`akari-osr-export` contribution が初期ウィンドウを destroy した直後に Theia の `handleMainCommand` →
`openDefaultWindow` が destroy 済みウィンドウへ `loadURL` して `TypeError: Object has been destroyed`（未処理 rejection）→
V8 fatal → SIGTRAP（exit 133 / Windows `0x80000003`）となり、PROGRESS 0 行で終わる。§11.4 の単一インスタンスロック解消後も
残る、contribution 方式の構造的な競合（`window-all-closed` → `app.quit()` とも競合し得る）。この経路（tier 1 の既定候補）は
fieldtest / 検収に receipt が 1 件も無く、一度も動いていない。

v0.1.27 からの挙動: `resolveOsrLauncher`（製品入口）はインストール済みアプリを既定で候補から外す
（`allowInstalledDesktop: false`）。`AKARI_OSR_ELECTRON` の明示指定は従来どおり tier 1。npm Electron（tier 2）が無い
パッケージ版では tier 3 = legacy へ警告付きで落ち、provenance に `engine_fallback` と理由が残る（`auto` / `osr` とも）。
根本修正 = `--render` を Theia より前に捕捉する書き出し専用の Electron 入口（別票）。入口が入ったら既定を戻す。

**2026-08-29 追記（根治）**: 書き出し専用の入口 `apps/shell/electron-entry.js` が合流した（§6 / §11.4）。`resolveOsrLauncher` の既定を戻し、インストール済みアプリを再び tier 1 の候補にする（v0.1.28〜）。`allowInstalledDesktop: false` は明示の opt-out として残す。

### 11.6 親の `ELECTRON_RUN_AS_NODE` が Electron 子プロセスへ継承される（2026-08-29 追記・#27）

v0.1.28 実機（macOS Apple Silicon / Windows RTX 5060）で実証: shell 配布の `akari` shim
（`ELECTRON_RUN_AS_NODE=1 exec <同梱 Electron> akari.mjs`）・アプリ内書き出し・パートナー CLI サーバーは、同梱 Electron を
node として使うためにこの変数を立てる。`launchElectronExport` が親の環境をそのまま子へ渡していたため、tier 1 の AKARI Video は
Chromium スイッチを `bad option` で拒否して exit 9、tier 2 の npm Electron は `electron-main.mjs` を素の Node で実行して
`app` が undefined になり、いずれも PROGRESS 0 行で終わる。GPU 出口（§12）も同じ launcher を共有するため同時に落ちる。
§11.4 / §11.5 の解消後に露出した、起動環境の問題。

修正後: `spawnAndWait` は `electronChildEnvironment(env)` を通した環境で起動する
（`ELECTRON_CHILD_ENV_BLOCKLIST = ["ELECTRON_RUN_AS_NODE"]`、名前は Windows に合わせ大文字小文字非区別で比較）。
他の変数（`AKARI_OSR_*` / `AKARI_FFMPEG_BIN` / `PATH` 等）は従来どおり継承する。shim 側で変数を外す案は採らない
（shim の外で立てられた変数には効かず、書き出し側で一律に守るのが唯一の境界）。

## 12. GPU 直結出口との共有境界（2026-08-28 追記）

[GPU 直結書き出し v0](./contract-2026-08-28-gpu-export-v0.md) は、本契約の launcher 3 段、static
server、page builder の入力解決、memory guard、ffprobe、音声 mux、receipt の語彙を再利用する。
省略可能引数の既定値は本契約の OSR 挙動を維持する。GPU 出口の適格性、readback 禁止、mp4box direct
mux、fail-closed 条件は GPU 契約を正本とし、OSR の seek/paint/stamp 経路へ逆流させない。
§1 の darwin `auto → osr` は GPU 出口追加前の記述であり、GPU 契約の適格性を満たさない場合、
または GPU launcher が利用できない場合の選択として読む。適格時の `auto → gpu` は GPU 契約を優先する。

## 13. v2 の cut 音声中間物（2026-08-29 追記）

OSR 経路の映像は `edit.sources` をページ側で直接読み、`cut.mp4` の映像を使用しない。そのため
cut 段は `cut-audio.mp4`、尺延長が必要な場合は続けて `cut-audio-tail-padded.mp4` を生成し、
音声ストリームだけを最終 mux へ渡す。両コマンドは `-vn` とし、映像のデコード・フィルタ・
エンコードを行わない。音声の trim、速度、freeze 無音、transition、gap、AAC 48 kHz の意味論は
従来の映像込み cut / tail-pad と同じである。legacy 経路は従来どおり映像込み中間物を使用する。
音声入力は cut ごとに入力側シーク（`-ss` / `-t`）し、cut 頭 0.5 s の先読みガード（AAC の overlap-add 用）を設け、cut 段の費用を素材長に依存させない。
