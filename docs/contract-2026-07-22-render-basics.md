# レンダー基礎機能契約（速度 / クロマキー背景置換 / 基本トランジション / LUT / 音声マスター処理 / 画角操作 / フリーズ）

- 日付: 2026-07-22（2026-08-06 追記: #6 画角操作 / #7 フリーズを増築。2026-08-09 追記:
  `layers[].keyframes` への一般化を §4-4 に追記）
- 状態: **draft**（実装と並走で approved 化）。本書は技術仕様のみ。
  判断経緯・実装レーンの運用は非公開の内部記録で管理する（本リポには置かない方針）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（三原則）、
  `contract-2026-07-13-m1-m4.md`（edit.json 正本）、
  `contract-2026-07-14-edit-json-v1-audio.md`（audio スキーマ）
- 大原則: **done = 出力ファイルに現れる**。全項目、実レンダリング出力の機械検証を
  受け入れ条件とする（仕様先行・バックエンドの silent drop を許さない —
  schema・実装・lint・出力検証を同時に納品する）

## 1. スコープ（7 機能・いずれも ffmpeg 直結）

| # | 機能 | edit.json 拡張（追記のみ） | ffmpeg 実装 | 出力検証 |
|---|---|---|---|---|
| 1 | 定速変更（クリップ単位の倍速/スロー） | `cuts[].speed`（number・既定 1.0・v0 は定速のみ、ランプは将来） | `setpts` + `atempo`（>2x/<0.5x の段組み） | 出力尺が理論値と一致（ffprobe）・音程/同期の実聴確認 1 点 |
| 2 | クロマキー背景置換 | `source.chroma_key`: {color, similarity, blend, background(色 or 画像/動画パス)} | `chromakey`/`colorkey` + 背景入力の `overlay` | 緑背景フィクスチャで背景が置換された出力のピクセルサンプル検証 |
| 3 | 基本トランジション | `cuts[].transition_out`: {type: dissolve/fade-black/fade-white/**reveal-down/reveal-up**, duration} | `xfade`（transition 指定があるカット境界のみ xfade 経路）。reveal 系は ffmpeg の `revealdown` / `revealup` | 境界フレームの中間ブレンド実在をフレーム抽出で確認・指定なし境界はハードカット維持。reveal 系は色が混ざらないため、遷移中間フレームの**上半分と下半分を別々に測って**前後カットが同居することを確認する |
| 4 | 色調フィルター（LUT） | `output.look`: {lut(プリセット参照 or パス), intensity} | `lut3d`（intensity は `blend` 併用） | LUT 有無 2 出力のフレームピクセル差分・プリセット表 `presets/luts/`（初期 2〜3 本。2026-07-29 に `catalog/luts/` から移設） |
| 5 | 音声マスター処理 | `audio.master`: {denoise(off/std/strong), loudnorm(target LUFS・既定 -14)} | `afftdn` / `loudnorm`（2 パスでなく 1 パス許容 v0） | 出力のラウドネス実測（ffmpeg ebur128）が目標 ±1LU |
| 6 | 画角操作（静的クロップ / ズームキーフレーム / 段階縮小） | `cuts[].framing`: `{crop?: {x,y,w,h}（0..1 の出力相対・静的）, keyframes?: [{t,scale,cx?,cy?}]（t=カット内秒・線形補間。2 点でズーム、3 点以上で段階縮小・cx/cy 省略時 0.5）}` | 出力キャンバスへフィット済みの frame を `crop` で窓抜きし `scale` で再拡大（punch-in）。静的 `crop` は `w/h/x/y` とも定数。ズームは `crop` 自身の `w/h` が実機検証で init 時一度しか評価されない制約があるため、`scale` 側を `eval=frame` で `scale(t)` 倍に広げ、`crop` は固定 `w=width:h=height` のまま `x/y` だけを `t` の関数で追わせる方式（詳細 §4-1） | 静的 crop は出力フレームの画素でクロップ位置が宣言どおりであることを実測・ズームは開始/中間/終端フレームで可視要素の実測サイズから逆算したスケールが線形補間の理論値と一致（±5%）・3 点キーフレームは 2 段階の縮小がフレーム抽出で確認できる |
| 7 | フリーズ（動画停止） | `cuts[].freeze`: `{at_sec, duration_sec}`（at_sec=カット内秒でフレーム静止・停止分だけカット尺が伸びる。コンテンツを削らない） | `trim` 分割 + `tpad`（`stop_mode=clone`）+ `concat`。カット先頭（at_sec=0）での静止は `tpad` の `start_mode=clone` が本機の ffmpeg で下流の `fps` フィルタと組み合わさると最終フレームを 1 枚欠落させるバグを実機検証で確認したため使わず、frame-index trim（`start_frame=0:end_frame=1`）で 1 フレーム種を取り出し `stop_mode=clone` で伸ばしてから先頭に concat する方式で代替（詳細 §4-2）。音声は該当区間を無音（`anullsrc`）で埋める（直前音の継続はしない・詳細 §4-3） | 静止区間内の 2 フレームが画素一致（ロスレスエンコードで実測）・出力尺 = 元尺 + duration_sec（ffprobe 実測）・静止区間の音声が無音であること（`silencedetect`/`volumedetect` 実測）を確認 |

- 除外（次段送り）: ブレンドモード・PinP・プリレンダ合成レール（レイヤー機構が前提のため）

## 2. 横断要件

1. schema は**追記のみ**（既存 edit.json が全て無変更で valid のまま）。validate-edit /
   edit-lint / fixtures / test を同時追随
2. プレビュー（preview-engine）は v0 では**近似不要・無視でよい**（出力最優先。
   「プレビューは近似・書き出しが正」の哲学を全項目に適用。プレビュー追随は別契約）
3. **`output.look`（#4 の LUT）の適用範囲は `cuts[]` の本編映像だけ**である。
   `layers[]`（PinP / 人物マット / B-roll）と `overlays[]` には**掛からない**。
   同じ絵の一部として重ねる素材の色を本編に合わせたいときは、`layers[].filter`
   （`{type:"lut", id, intensity}`。正本 = `contract-2026-08-12-region-filter-layer-v0.md` §4）
   へ**同じ `id` / `intensity` を明示的に宣言する**。
   実害例（2026-08-14・リール制作）: 本編にだけ `cinematic` が乗り、重ねた人物切り抜きが
   素の色のまま合成されて、窓の継ぎ目で肌色が食い違った。「プロジェクト全体の色」だと
   誤解しやすいため、ここに明記する。

### 2-4. reveal 系トランジション（`reveal-down` / `reveal-up`。2026-08-14 追加）

**前カットが丸ごとその方向へ動いて画面外へ抜け、空いた側から次カットが現れる**
（前カットは動きながら画面端でクロップされる）。ディゾルブのように混ざらないので、
**同じ構図が続くトークシーンでも「場面が入れ替わった」ことが読める**のが採用理由
（オーナー指定 2026-08-14「テンプレの基本トランジションとして必要」）。

- `reveal-down` = 前カットが下へ降りる（画面上部から次カットが出てくる）
- `reveal-up` = 前カットが上へ抜ける（画面下部から次カットが出てくる）
- 実測（64x64・10fps・duration 1s・遷移中間 t=2.5s）: `reveal-down` で上半分 RGB(0,0,253)＝次カット /
  下半分 RGB(252,0,0)＝前カット。`reveal-up` はこの上下が入れ替わる
- **他の xfade と同じく、遷移の重なり分だけタイムラインが縮む**（境界 1 つにつき `duration` 秒）。
  `layers[]` / `overlays[]` / `audio.sfx[]` を**タイムライン秒で手置き**しているプロジェクトでは、
  トランジションを足すと後続の配置が全部ずれる。字幕は (`src`, source 秒) で書くのでエンジンが
  追随するが、手置きの要素は自分で引き直す必要がある。尺を変えたくない場合は、
  トランジションではなくオーバーレイで表現する（前カット最終フレームを焼いて動かす）という
  逃げ道もあるが、静止画になるうえプロジェクト固有の焼き込みが要るので既定にはしない

## 3. 残裁定

1. `speed` の音声ピッチ保持（atempo = ピッチ維持）を既定とするか、ピッチ変動オプションを持つか
2. LUT 初期カタログの中身の選定
3. xfade 移行で render-cut の concat 構造をどこまで作り替えるか（v0 = 指定境界のみ / 全面 xfade 化）

## 4. #6/#7 実装決定（2026-08-06 追記・画角操作 + フリーズ増築）

### 4-1. 画角（`cuts[].framing`）

- **crop と keyframes の併存**: 両方宣言された場合は `keyframes` を優先する。`crop` は「1 点ズームの縮退形」であり、両立させる意味論が無いため（複製 drift の温床にもなる）
- **scale < 1 の扱い**: `keyframes[].scale` は仕組み上「クロップ窓を縮めて拡大する」ため 1 未満（キャンバスの外まで見せる＝リビール）は原理的に表現できない。レンダ側で `max(1, scale)` にクランプする（silent drop ではなく仕組み上の上限として契約に明記）
- **crop.w/h が init 一度しか評価されない**: ffmpeg の `crop` フィルタは `x`/`y` は `t` を使った毎フレーム再評価に対応するが、`w`/`h` は（この ffmpeg ビルドで）フィルタ初期化時の一度きりの評価に固定されており `eval` オプション自体が存在しない（実機検証: `t` を含む `w`/`h` 式は `crop=... w='...t...'` で `Error when evaluating the expression` を返す）。そのため実装は「`scale` を `eval=frame` で `width*scale(t) : height*scale(t)` に広げてから固定サイズ `width:height` で `crop` する」方式を採る（クロップ窓の拡大 = `scale` 側の時間関数、パン位置 = `crop` の `x`/`y` の時間関数、という役割分担）
- **`crop` の `x`/`y` は上流フレームの実サイズを見ない**: 同フィルタの `iw`/`ih` 定数は（動的サイズの上流から来ていても）negotiate 済みの固定リンクサイズを指し、最初のフレームのサイズに固定されたままになることを実機検証で確認した。そのため `crop` の `x`/`y` 式は `iw`/`ih` を参照せず、`scale` 側と同じ `scale(t)` 式をそのまま再計算する（対称的だが唯一 crop から見て正しい現在値）
- **ズーム中の左右ちらつき修正（2026-08-06 追記・オーナー実機指摘・ws:framing-zoom-flicker）**: `crop` の `x`/`y` は ffmpeg 上フレーム整数ピクセル位置でしか表現できず、連続的に変化する `scale(t)` は毎フレーム 1px 刻みの階段状に量子化される。この階段と本来の滑らかな軌跡との差が、細かい周期パターン上で左右にスナップするちらつきとして見える（チェッカーボード実測フィクスチャで確認: 元実装は連続フレーム間で 78% の確率で位置が逆方向に振れ、平滑トレンドからの残差 stdev 0.51px）。`scale` のフラグ変更（`bilinear`→`lanczos`）は無効（値の補間精度は変えるが `crop` の位置精度そのものは変えないため）。有効だったのは**スーパーサンプリング**: `cuts[].framing.keyframes` のズーム計算をキャンバス解像度の 2 倍（`SUPERSAMPLE=2`）で行ってから高品質フィルタで実解像度へ縮小する方式で、`crop` の 1px 量子化ステップが出力ピクセルの 1/2 になる分だけちらつきが縮む（同フィクスチャで stdev 0.51px→0.26px、連続フレーム逆方向率 78%→41%、いずれも約 48% 改善）。あわせて `scale`/`crop` 双方が参照する「現在の拡大後サイズ」式を偶数丸め（`trunc(x/2)*2`）に統一し、`scale` が実際に負向する整数サイズと `crop` 側の想定がフレームによって食い違う（`crop` 内部クランプが暗黙に発火する）ケースを閉じた。静的 `crop`（`framing.crop`、ズームではない一点窓抜き）は時間不変のため対象外・無変更

### 4-2. フリーズ（`cuts[].freeze`）— ffmpeg 実装上の制約

- **`tpad` の `start_mode=clone` は使わない**: カット先頭（`at_sec=0`）での静止を素直に `tpad=start_mode=clone:start_duration=X` で実装すると、後続に（本機能の他パスも含め）`fps` フィルタが一つでも挟まると出力の**最終フレームが 1 枚欠落する**バグをこの ffmpeg ビルドで実機検証した（`stop_mode=clone` には同じ問題が無いことも確認済み）。代わりに、`split` で複製した全区間トリムの一方を `trim=start_frame=0:end_frame=1`（フレーム番号ベース・fps に依存しない）で 1 フレームへ切り、`stop_mode=clone` + `stop=<フレーム数-1>`（時間指定の `stop_duration` ではなく整数フレーム数）で伸ばしてから元の全区間へ concat する
- **フリーズ中の音声は無音挿入**（direct 音の継続やループはしない）: 直前音をループさせるとループ境目でクリックノイズが乗る（PCM の非ゼロ交差での接続）のに対し、無音挿入は決定論的でグリッチが無い。narration/BGM/SFX は出力タイムライン上の絶対秒で独立に配置される既存契約（`cuts[].speed` と同じ前提）のため、freeze による尺の伸びに合わせて自動シフトはしない
- **v0 は gap-aware タイムライン（明示 `at`/`track`）との併用不可**: gap-aware パス（`computeVideoRuns`）の出力秒→ソース秒写像は速度係数のみを前提にした線形式で、フリーズによる非線形な静止区間があると破綻する。`cuts[].freeze` が宣言された状態で gap-aware 判定（`needsGapAwareCutTimeline`）が真になる場合、render-cut は明示的に例外を投げて止まる（silent drop を許さない契約の原則どおり、機能を無言で無視しない）。デフォルトの逐次タイムラインでのみ有効
- **v1（2026-08-18 追記）も同じ制約**: `contract-2026-08-18-v1-render-parity.md` で v1
  （`sources[]`）の `buildMultiSourceCutCommand` にも gap-aware タイムライン（`buildGapAwareMultiSourceCutCommand`）が入った。理由は v0 と全く同じ（`computeVideoRuns` の線形写像がフリーズを表現できない）ため、`cuts[].freeze` + 明示 `at`/`track` の組み合わせは v1 でも同じ例外で止まる

### 4-3. プレビュー乖離

画角（`cuts[].framing`）とフリーズ（`cuts[].freeze`）はレンダ（本契約 #6/#7）のみの対応であり、Web UI / shell のプレビューは追随していない。`docs/contract-2026-08-02-preview-parity.md` の適合状況表に明示済み。

### 4-4. 変形キーフレームの一般化（`layers[].keyframes`。2026-08-09 追記）

`cuts[].framing.keyframes`（#6・上記 4-1）が確立した「時刻付きの部分状態の配列・線形補間・
hold-before/after」という形は、`layers[]`（PinP）の変形（`transform.x/y/scale/rotate`・
`crop`・`perspective`）全般を動かす共通機構 `layers[].keyframes` として一般化された
（オーナー指示 2026-08-09。パース単独の専用機構は作らない）。`layers[]` は本契約のスコープ表
（§1）に無く、`layers[].crop`/`layers[].perspective` 自体の契約は
`docs/contract-2026-08-02-preview-parity.md` §2.4.1/§2.4.4 が正本のため、`layers[].keyframes`
の適用順・補間規則・ffmpeg 実装（`eval=frame` 区分線形式 / crop の異方 scale-up-crop-down 技法 /
perspective のレイヤー分割フォールバック — perspective は `crop` の `w`/`h` 同様
"per-frame 評価に対応しない" 制約を持つが、ffmpeg 側に時刻変数自体が無いためこの技法すら
使えず、レイヤー分割へフォールバックする点が crop/framing と異なる）・プレビュー再現の詳細は
すべて同契約 §2.4.7 に記載する（本ファイルでの重複記載はしない — SSOT は 1 箇所）。

## 5. macOS の字幕レンダ用 Chrome 起動（2026-08-24 追記）

- macOS では `.app` 内の Chrome 実行ファイルを子プロセスとして直接起動しない。書き出し専用の
  一意な `user-data-dir` を作り、`/usr/bin/open -na <Chrome.app> --args` で LaunchServices
  経由の新規インスタンスを起動する。
- `--remote-debugging-port=0` で起動し、専用プロファイルの `DevToolsActivePort` を
  タイムアウト付きで待ってから `puppeteer.connect()` する。通常の連番 PNG 経路と静止画経路は
  同じ起動・接続・終了層を使う。Linux / Windows は共通層内の `puppeteer.launch()` で
  実行ファイルを直接起動する。
- 正常・異常を問わず、接続済み Chrome は CDP の `Browser.close` 相当で終了し、専用プロファイルを
  削除する。macOS の終了設計は PID の推測や広域 `kill` に依存しない。
- Chrome 不在、`.app` でない実行ファイル、`DevToolsActivePort` 待機または接続の失敗は、
  「字幕レンダ用ブラウザの起動に失敗した」ことと Chrome の確認を日本語で示し、書き出しを
  非 0 で停止する。別スタイルの簡易字幕へは切り替えない。
