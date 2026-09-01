# エンジン v2 パリティ契約 — ゴールデンフレーム検収

> **2026-08-28 v2 改訂。** 本契約は面ごとに独立した描画実装を比較する契約から、単一の
> frame-engine を二つの器と二つの出口が消費する契約へ改訂した。互換経路は §4.3 だけが扱い、
> 仕様の正本には含めない。

## 改訂履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-08-02 | v0 | Web UI と shell の挙動仕様を統合 |
| 2026-08-28 | v2 | `packages/frame-engine` の意味論へ統合し、検収をゴールデンフレームへ一本化。出口を OSR と GPU 直結の 2 本に固定し、互換経路を退役節へ移動 |
| 2026-08-31 | v2.1 | §5.2 に断片 CSS の `vw` / `vh` 系単位の出力サイズ基準化（`viewport-units.js`。プレビューがウィンドウ幅基準で解いていた実機報告の修正）を追記 |

## 1. 役割分担

### 1.1 エンジン

エンジンは `packages/frame-engine` だけである。宣言済みの edit、source、sidecar と時刻 `T` を入力し、
その時刻の完成フレームを返す **`T → frame` の評価関数一個**を意味論の正本とする。cut、layer、
transition、matte、LUT、freeze、framing、keyframe の評価順序や時刻写像を器側へ複製しない。

音声は同じ決定論的予定表から開始、trim、loop、gain、fade、ducking 対象区間を得る。ただし即時再生と
納品マスターの処理差は [v2 音声処理の役割分担](./contract-2026-08-28-v2-audio-roles-v0.md) に従う。

### 1.2 器

器は次の二つである。器の責務は入力のロード、再生クロック、seek、frame-engine の呼び出し、完成フレームと
DOM overlay の提示、診断値の表示に限る。

| 器 | 実体 | 責務 |
|---|---|---|
| Web UI | `packages/preview-server` | ブラウザ内の対話プレビュー、scrub、編集操作、frame-engine の評価結果の提示 |
| shell | `apps/shell` の `akari-preview` | Theia webview 内の対話プレビュー、scrub、編集操作、同じ frame-engine の評価結果の提示 |

器は独自の画素意味論を持たない。器の差はホスト、入力手段、UI chrome、フレーム提示時の転送方式だけである。

### 1.3 出口

出口は `packages/osr-export` の OSR と `packages/gpu-export` の GPU 直結の 2 本である。OSR は
frame-engine の完成フレームと同じ DOM 規約の overlay sheet をページ全体で捕捉する。GPU 直結は、
適格な DOM 層を engine canvas 上のスプライトへ移し、完成 canvas を `VideoFrame` と WebCodecs へ直接渡す。
OSR の page/stamp/seek-paint は [ページ全体 OSR 書き出し v0](./contract-2026-08-28-osr-export-v0.md)、
GPU の適格性/readback/mux は [GPU 直結書き出し v0](./contract-2026-08-28-gpu-export-v0.md) を正本とする。

## 2. エンジンの意味論

### 2.1 cuts と時刻

`cuts[]` は `at` の明示配置、track、source の `in` / `out`、speed、gap を解決した出力タイムラインとして
評価する。指定時刻 `T` に有効な cut がなければ背景を返す。同一 track の重なり、異なる track の積層、
cut 境界の選択は宣言順ではなく解決済みタイムラインと z-order で決める。

**検収:** base parity **28 点**、layer parity **36 点**、frame lifetime **1000 コマ**を raw frame
`diff 0` で判定する。

### 2.2 framing、transform、opacity、freeze、keyframes

- `framing.crop` は fit 済みフレームを窓抜きして出力寸法へ再拡大する。
- `framing.keyframes`、transform keyframes は cut 内の出力秒で評価し、hold / linear / ease-in-out の
  指定補間を使う。
- `cuts[].transform` は出力中央を基準に scale、rotate、x / y を適用し、`opacity` は合成前の alpha に掛ける。
- framing と transform は一つの評価グラフで順序を固定する。器の CSS pivot や要素箱へ意味論を委ねない。
- `freeze = {at_sec, duration_sec}` は指定 frame を保持し、cut の出力尺を `duration_sec` だけ伸ばして
  後続の逐次 cut を移動する。freeze の画と独立音声予定表を混同しない。

**検収:** framing / transform / opacity / freeze を含む base parity **28 点**、freeze をまたぐ
frame lifetime **1000 コマ**、故意の **1 px** 差分を必ず FAIL させる否定点で判定する。

### 2.3 layers と keyframes

`layers[]` は base より上、字幕・overlay より下へ z-order 順に積層する。source trim、loop、crop、
transform、opacity、corner-pin perspective、各 keyframe を指定時刻 `T` で評価する。crop の錨点、
perspective の四隅、rotate 後の bounding box は frame-engine 内の同じ座標系で解決する。

**検収:** layer parity **36 点**を `diff 0` で判定する。

### 2.4 transition

cut 間の `dissolve`、`fade-black`、`fade-white`、`reveal-down`、`reveal-up` は、transition 区間に
前後二つの source frame を同時評価して合成する。境界、進捗率、カーブ、色 plate、reveal 方向は
frame-engine の意味論に固定する。器や ffmpeg 固有の xfade 擬似乱数へ依存しない。

**検収:** transition parity **90 点**、transition semantics **30 点**を `diff 0` で判定する。

### 2.5 matte と chroma key

人物 matte と chroma key は source / layer の alpha を生成し、色補正後・積層前の定められた位置で適用する。
matte の frame number は完成画と同じ `T` から得て、非同期応答や前回 frame を流用しない。人物の後ろへ置く
DOM 表現も、この alpha と同じ frame stamp へ同期する。

アルファ付き WebM / MOV は器と出口の入力境界で H.264 の straight color と
`gray-h264-fullrange` mask へ取り込み、frame-engine 自体にはこの 2 入力だけを渡す。同一素材の変換は
冪等かつ同時呼び出しを一つへ合流し、失敗時は該当 layer を警告付きで省略して base の評価を継続する。
互換 `<video>` と legacy filtergraph はこの変換の対象外である。

**検収:** matte parity **3 点以上**、matte sync **300 コマ・mismatches 0**を要求する。
alpha 素材の取り込み形と、事前に color + mask へ分離した形の完成画は 3 点以上で比較し、
channel absolute difference の mean **1.0 以下**、p99.9 **3 以下**を要求する。

### 2.6 LUT と output look

`output.look` は chroma / alpha の意味論を壊さない位置で LUT を適用し、`intensity` は未適用と全適用の
線形混合とする。色変換は `bt709-limited` を正とし、未タグ素材を bt601 とする legacy の換算へ合わせない。

**検収:** look parity **20 点**を `diff 0` で判定する。色裁定の実測は OSR §11.2 の
bt601 MAD **9.28** / maxDelta **155**、bt709 MAD **0.886** を根拠とする。

### 2.7 GOP、B フレーム、末尾 frame

seek は keyframe から対象時刻まで decode し、presentation timestamp と edit list の media time を反映する。
負の DTS、B フレーム並べ替え遅延、GOP 末尾でも直前 frame や 2 コマ手前を返してはならない。source 末尾は
宣言 duration と実在する最終 presentation frame の双方を扱う。

**検収:** gopTail **9 点**、bFrame **160 行**（summary **10**）、bFrameTail **24 行**、
`test:seek` の requestCount **94**、bFrame.rows **720**（coverage full）、bFrameTail.rows **24**、
finalFrameNumber **239**、lookahead hits **8**を要求する。

### 2.8 字幕

字幕は `captions.json` の active cue、style、safe area、word timing を一つの DOM 規約へ正規化する。Web UI と
shell のプレビューでは DOM 層として提示し、書き出しでは同じ DOM 規約から overlay sheet を構成する。
器専用の字幕 HTML や出口専用の再レイアウトを持たない。

**検収:** OSR ソフト描画の同一 fixture 2 走について、字幕を含む全コマ raw BGRA の SHA-256 一致を要求する。

### 2.9 overlays

`overlays[]` の自由 HTML、表、グラフ、2D / 3D 表現は同じ DOM 規約と同じ時刻 stamp で評価する。Web UI と
shell では DOM 層、OSR では overlay sheet として載せる。活性区間ごとに DOM を再構築せず、状態を固定した
ページを seek-safe に更新する。

**検収:** OSR ソフト描画の同一 fixture 2 走について、overlay sheet を含む全コマ raw BGRA の
SHA-256 一致を要求する。GPU は同一マシン一致率を診断値として記録する。

### 2.10 音声

開始、trim、loop、gain、fade、ducking 対象区間は映像と同じ決定論的予定表から求める。器は Web Audio で
即時再生し、出口は ffmpeg で acrossfade、mix、`afftdn`、`loudnorm`、true peak guard を含む納品マスターを
作る。-12 dB 矩形 ducking とマスター処理省略は宣言済みの近似であり、画素パリティへ混ぜない。

**検収:** 5 分通し再生 29 点と 30 回 seek の計 59 点で最大 drift **16.667 ms**、p95 **6.666 ms**、
上限 **33 ms**。音量差は audio-roles §3.2 の I / LRA / TP と ducking 実測を診断値として残す。

## 3. 適合状況

凡例: ✅ = 本契約の経路、🟡 = 契約された近似または実機残課題、— = その境界の責務ではない。

| 機能 | エンジン (`frame-engine`) | Web UI 器 (`preview-server`) | shell 器 (`akari-preview`) | OSR 出口 (`osr-export`) | GPU 出口 (`gpu-export`) |
|---|---|---|---|---|---|
| 時刻 `T`、cuts、gap、track | ✅ 評価 | ✅ 呼び出し・提示 | ✅ 呼び出し・提示 | ✅ 連番駆動 | ✅ 連番駆動 |
| framing / transform / opacity / freeze | ✅ 評価 | ✅ 完成 frame を提示 | ✅ 完成 frame を提示 | ✅ 完成 frame を捕捉 | ✅ canvas を直結 |
| layers / perspective / keyframes | ✅ 評価 | ✅ 完成 frame を提示 | ✅ 完成 frame を提示 | ✅ 完成 frame を捕捉 | ✅ canvas を直結 |
| 5 transitions | ✅ 評価 | ✅ 完成 frame を提示 | ✅ 完成 frame を提示 | ✅ 完成 frame を捕捉 | ✅ canvas を直結 |
| matte / chroma key | ✅ 評価 | ✅ stamp 同期 | ✅ stamp 同期 | ✅ stamp 同期・捕捉 | ✅ 同一 frame 評価 |
| LUT / `bt709-limited` | ✅ 評価 | ✅ 提示 | ✅ 提示 | ✅ 捕捉・encode | ✅ LUT 後 canvas を直結 |
| 字幕 | — DOM 規約へ active state を供給 | ✅ DOM 層 | ✅ DOM 層 | ✅ 同規約の overlay sheet | 🟡 適格 cue を sprite 化 |
| overlays / 3D | — DOM 規約へ時刻を供給 | ✅ DOM 層 | ✅ DOM 層 | ✅ 同規約の overlay sheet | 🟡 static / 宣言型 3D のみ |
| 音声予定表 | ✅ 区間評価 | 🟡 Web Audio 近似 | 🟡 Web Audio 近似 | ✅ ffmpeg 納品マスター | ✅ carrier 後に同じ master |
| Windows 実機 | ✅ platform-neutral | — Web browser | 🟡 実機残課題 | 🟡 実機残課題 | — v0 非対応 |

未完項目の移管先は [エンジン v2 残課題](./notes-2026-08-28-engine-v2-open-items.md)、近似の判定正本は
[エンジン v2 恒久近似清算表](./contract-2026-08-28-v2-approximation-ledger.md) とする。

## 4. 検収と退役

### 4.1 ゴールデンフレーム検収

エンジンの画素検収は `packages/frame-engine/test/golden` 一本に統一する。器別に別の完成画を作って
目視比較する方法は合否判定に使わない。

| 検収群 | 点数・実測値 | 合格条件 |
|---|---:|---|
| base parity | 28 点 | preview / export raw frame `diff 0` |
| layer parity | 36 点 | `diff 0` |
| matte parity | 3 点以上 | `diff 0` |
| transition parity | 90 点 | `diff 0` |
| transition semantics | 30 点 | `diff 0` |
| look parity | 20 点 | `diff 0` |
| GOP tail | 9 点 | 対象 presentation frame と一致 |
| B frame | 160 sampled 行、summary 10 | 対象 presentation frame と一致 |
| B frame tail | 24 行 | 末尾 frame と一致 |
| frame lifetime | 1000 コマ | 全コマ完走、stale frame なし |
| matte sync | 300 コマ | mismatches 0 |
| negative | 故意の差分 1 px | 必ず FAIL |
| `test:seek` | request 94、B frame 720 行、tail 24 行 | coverage full、finalFrameNumber 239、lookahead hits 8 |

### 4.2 許容差

| 境界 | 許容差 | 合否 |
|---|---|---|
| frame-engine golden | raw frame `diff 0` | 1 px でも不合格 |
| OSR ソフト描画 | 同じ入力の 2 走で全コマ raw BGRA SHA-256 一致 | 不一致 1 コマでも不合格 |
| OSR GPU・同一マシン | 2 走の一致率、`differingPixels`、`maxDelta` を記録 | byte-exact は診断値であり合否条件にしない |
| OSR GPU・別マシン | #14 Windows 実機を含む platform 差を記録 | 共通 byte-exact は要求しない |
| GPU 直結・engine 区間 | OSR decode 比較の per-frame MAD ≤ 1.0 | 超過は不合格 |
| GPU 直結・字幕 | cue 代表 5 時刻の下半分 MAD ≤ 1.0 | 超過は不合格 |
| GPU 直結・3D | 3D active 区間 MAD ≤ 1.0 | 超過は不合格 |
| GPU 直結・DOM 層 | overlay 外接矩形内 MAD ≤ 1.0、t=0 を含む代表 5 時刻 | いずれかの超過または sentinel 不一致は不合格 |

OSR の比較は H.264 を再 decode した画像ではなく捕捉時の raw BGRA を使う。ソフト描画の検収と GPU の
診断値を混同しない。

### 4.3 互換経路の残置と退役スケジュール

Web UI と shell に残る `<video>` ベースのプレビュー、および render-cut の ffmpeg filtergraph による
> **2026-09-01 退役:** 以下の互換期間の記述は履歴記録であり、現在の書き出し出口は GPU / OSR のみ。

legacy 合成経路は、移行中の既存利用者と Windows を支えるための**互換期間の残置**だった。どちらも
エンジン意味論や完成画の仕様の正本ではない。

- `<video>` ベースの二つの互換プレビューは、各器で frame-engine が既定になった後 **2 リリース**保持する。
- legacy 書き出しは明示的な互換選択で到達可能なまま残し、コードとテストを削除・無効化しない。
- legacy 削除（#100b）は、#14 の Windows 実機で OSR が PASS するか、Windows でも OSR を既定にする
  オーナー裁定がある場合にだけ開始する。
- 退役前も新しい意味論を互換経路へ追加しない。差は清算表へ記録し、v2 の合否は §4.1 と §4.2 で決める。

## 5. 器の規約（エンジン意味論の外）

### 5.1 字幕 DOM の既定

字幕の見た目と行分割の正本は、器と overlay sheet が共有する §2.8 の字幕 DOM 規約である。

- 縁取りは shadow ではなく実ストロークとし、既定を
  `-webkit-text-stroke: 0.14em rgba(0,0,0,.9)` と `paint-order: stroke fill` にする。
  `text_style.stroke.width_px` は**外側に見える太さ**を表すため、CSS の実ストローク幅には指定値の
  2 倍を渡す。
- 座布団（plate）の既定は無しとし、`--plate-bg: transparent` を使う。背景は明示指定された場合だけ
  opt-in で描く。
- `output.height > output.width` を縦長、それ以外を横長として次の既定を選ぶ。

| 項目 | 横長 | 縦長 |
|---|---:|---:|
| フォントサイズ | 38 px | `round(output.width × 0.06)` px |
| 1 行の文字数予算 | 20 | 10 |
| 無指定で複数行になる字幕 | 全行を静的表示 | `words[]` があれば reveal へ自動昇格し、無ければ静的表示 |

- 行分割は **句読点 → 空白 → 文節境界 → 文字上限**の順に候補を選ぶ。word の途中では折り返さず、
  最寄りの word 境界へスナップする。
- style、サイズ、行数、表示方式などの明示指定は、常に上記の既定より優先する。

### 5.2 overlays の解決

`overlays[].html` は、値が `<` で始まればインライン HTML、それ以外は
`edit.json` のあるディレクトリからの相対ファイルパスとして解決する。`vars` は `--` で始まるキーだけを
CSS カスタムプロパティとして overlay root へ適用し、それ以外のキーは DOM や JavaScript へ注入しない。

断片 CSS の `vw` / `vh` / `vmin` / `vmax`（`dvw` 等の接頭辞付き・`vi` / `vb` 含む）は**出力サイズ基準**で
解決する（`1vw` = `output.width / 100` px）。書き出しは出力サイズちょうどの viewport で overlay sheet を
描くので素のままで正しいが、器のプレビューはステージを `scale()` でペインへ収めるため素の `vw` は
ウィンドウ幅基準になってしまう。器は mount 時に `packages/overlay-runtime/src/viewport-units.js` で
`<style>` / `style=""` の `<数値><単位>` を `calc(<数値> * var(--akari-vw, 1vw))` へ書き換え、ステージ要素に
`--akari-vw` 等（出力サイズ / 100 px）を定義して一致させる（2026-08-31。shell / Web 共通。`@media` 等の
プレリュード・文字列・`url()` は書き換えない）。

### 5.3 書き込み経路

UI、API、RPC の別を問わず、`edit.json` / `captions.json` へのすべての書き込みは edit-lint ゲートを通す。
lint 実行系が見つからない場合は **fail-open**（2026-08-02 オーナー裁定）とし、警告を表示・記録したうえで
保存を続行する。書き込みは tmp ファイルへの出力と rename による atomic 更新とする。実装は
`packages/edit-store` に一本化し、器や入口ごとの独自書き込み実装を追加してはならない。

### 5.4 ペン

ペン描画の単一正本は `packages/pen-visuals` の `PEN_TUNING` と描画プリミティブである。器や overlay
sheet が独自の補間、太さ、透明度、消去規則を持ってはならない。フェード時間は **600ms** を正とする
（2026-08-02 オーナー裁定）。

### 5.5 プレビュー用プロキシの規格

frame-engine がランダムアクセスするプレビュー用プロキシは、H.264 High Profile の 8bit
`yuv420p`、GOP 1 秒以下、B フレームなし、faststart とする。GOP はソースの実測 fps を丸めた
フレーム数を使い、`-g <fps> -keyint_min <fps> -sc_threshold 0 -bf 0` を指定する。変換後も尺と
コマ数はソースと一致させる。
29.97 fps の GOP は 30 コマで 1.001 秒になるため、doctor / lint などで機械照合するときの閾値は 1.05 秒に置く。

生成経路は shell の HEVC フォールバックと preview-server の HEVC プロキシの 2 系統であり、
いずれも `packages/media-bin/src/proxy-recipe.mjs` を唯一の定義として使う。レシピ版
`gop1s-v1` は shell のキャッシュキーと preview-server の出力名へ含め、旧規格のキャッシュを
次回参照時に再利用しない。

### 5.6 読み込み予算と原本 / proxy の選択規則

frame-engine のソース読み込み予算は、`Content-Length` が得られる場合
`max(10 秒, bytes / 8 MiB毎秒)` とする。予算を超えても受信進捗が続く間は打ち切らず、進捗が
5 秒間止まった場合に失敗とする。同一 URL の fetch はセッションにつき 1 回に限り、再試行では
取得済みバイトと解析済み moov / キーフレーム索引を再利用する。

v2 プレビューの既定選択は次の順序とする。

1. 宣言済み proxy があれば proxy を使う（`declared`）
2. proxy が無ければ codec をプローブし、`hw || any` で扱える場合は原本を使う
   （`hardware-ok` / `decoder-ok`）
3. 扱えない場合は preview-server に自動プロキシを要求し、生成中は非致命の通知を表示する
   （`auto-proxy`）

Web UI の `?frameEngineSource=original`、または shell の
`AKARI_FRAME_ENGINE_SOURCE=original` では 1 を飛ばして器の実力判定へ進む。`=proxy` では従来どおり
proxy を無条件に優先する。
`AKARI_FRAME_ENGINE_FORCE_SW=1` はハードウェアデコード不可を模擬するテスト用スイッチである。
HEVC は `prefer-software` が通らないため、codec プローブが `sw=false` を返した系列について
ClipSessionPool はソフトウェア退避を学習しない。ソフトウェア退避の学習対象は H.264 のみとする。

tkhd に 90 / 180 / 270 度の回転を持つ素材は、既定でデコーダ出力を毎フレームの
OffscreenCanvas へ焼き直さない。frame-engine は回転メタをフレームへ付帯し、compositor の
UV 逆写像で表示回転を 1 回だけ適用する。crop、framing、keyframe、既存 transform / perspective は
回転後の論理空間を基準とし、90 / 270 度では coded width / height を入れ替えた論理寸法を使う。
この規則は VideoFrame の直接 upload と copyTo の両経路に共通である。

デコーダエラーは window 全域イベントで飛ぶため、他クリップの失敗と区別できない。frame-engine は
検出後 `decoderErrorGraceMs`（既定 1 秒）だけ自分の操作の成功を待ち、期限内に成功した場合はその
エラーを無視する。prime がフレームを返さず、かつエラーを観測した場合だけ、その試行を失敗とする。

### 5.7 映像ソースの読み方とパリティ

frame-engine が MP4 を全体ストリームとして読むか、`ftyp` / `moov` の索引と必要な圧縮サンプルの
Range として読むかは、完成画の意味論に影響しない。どちらの読み込み経路も同じ presentation 時刻の
VideoFrame を §4.1 の評価点へ供給し、`elst.media_time`、B フレームの並べ替え、メディア終端を含めて
golden の `diff 0` を満たさなければならない。ソース取得方法の変更をパリティ差の許容理由にしてはならない。
