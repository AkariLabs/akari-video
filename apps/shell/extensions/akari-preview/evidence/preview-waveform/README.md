2026-09-06 廃止: 再生バーの波形帯は削除され、ボタンは音声メーターを開く（task 2026-09-06-preview-transport-v2）
# preview-waveform — 検証記録

対象: `apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts`

## 結論

- **L0: PASS**（`build:ext` / `lint` / `build` すべて実測 exit 0）
- **L1: PASS**（Electron 実機 + CDP。受け入れ条件 1〜8 を全項目実測。波形/フォールバック 2 枚 + 回帰 8 枚のスクショと run-log/results JSON）

## L0

- `npm run build:ext`: exit 0
- `npm run lint`: exit 0
- `npm run build`: exit 0（browser / node / electron はすべて 0 errors）
- `node --check extensions/akari-preview/evidence/preview-waveform/run-waveform-e2e.mjs`: exit 0

## 波形データ取得の修正（実装ラウンドで発見・修正）

実装直後の実機検証では、波形行の表示・56px 高さ・シーク行との幅一致・`aria-pressed` は PASS したが、
canvas は背景とプレースホルダ文字だけになり、波形バーを描画できなかった。動画ストリームの URL を
webview から `fetch()` すると、ストリーム応答に CORS 許可ヘッダがないためブラウザがリクエストを拒否するのが原因だった
（`Access to fetch at 'http://127.0.0.1:<port>/media/<hash>' ... has been blocked by CORS policy` を実機コンソールで実測）。
CSP の `connect-src` 許可だけでは CORS の許可にはならない。

修正後は webview からホストへメッセージで動画バイト列を要求し、ホストが FileService で読み取ったデータを
base64 応答として返す。webview は応答を ArrayBuffer に戻して `decodeAudioData()` へ渡すため、動画ストリームの
HTTP fetch と CORS を経由しない。ピーク計算・描画・メモリキャッシュ・音声なし動画のフォールバックは変更していない。

## L1 実測結果（受け入れ条件 1〜8、すべて実測値付き）

| # | 期待値 | 実測 |
|---|---|---|
| 1 | 初期非表示 → トグルでシークバー直上に出現（rect 実測） | `hidden:true→false`, `aria-pressed:"false"→"true"`。行高さ 56px（実測）、幅 690px でシーク行と一致、行下端(533) ≤ シーク行上端(541)。`01-waveform-visible.png` |
| 2 | canvas に背景色以外のピクセル、シアン/オレンジ両方の存在 | `cyan=7528`, `orange=29000`, `nonBackground=39288`（閾値 1000 超）。同スクショに含まれる |
| 3 | 25% クリックで `currentTime = 0.25*duration ±0.3s` | `duration=20` に対しクリック後 `currentTime=5`（0.25×20=5 ちょうど） |
| 4 | 再生中の playhead `left` が単調増加 | サンプル列（%）: `26.3571 → 27.5997 → 28.9343 → 30.1792` |
| 5 | 再トグルで行が消え、`aria-pressed` が追従 | `hidden:false→true`, `pressed:"true"→"false"` |
| 6 | 音声無し動画でフォールバック描画、既存 transport は継続動作 | 描画テキスト `["波形を生成中…","この動画の波形は生成できません"]`。`play-toggle`/`seek`/`waveform-toggle` の `disabled` はすべて `false`（既存機能は継続動作）。`02-waveform-fallback.png` |
| 7 | 回帰: `run-transport-zoom-e2e.mjs` が引き続き全 PASS | 19 個の assert すべて PASS（`SUCCESS: all transport/zoom/pan/minimap/fullscreen/regression checks passed.`）。`regression/` 配下にスクショ 8 枚 + `results.json` + `run-log.json` |
| 8 | evidence README に実測値を記録 | 本ファイル |

## 検証中に判明した環境依存の事実（正直に記録）

- **ffmpeg `sine` lavfi ソースの既定ピーク振幅は約 -18dB（≈0.125）**であり、本タスク契約が例示する
  `volume='if(lt(t,5),0.05,if(lt(t,10),0.9,0.3))'` のまま生成すると、大音量区間でも実ピーク値は
  約 0.11 にしかならず、オレンジ色分けの閾値（peak ≥ 0.92）に届かない。検証用 fixture では
  大音量区間の倍率を `0.9` → `7.8` に引き上げ、`astats` で実ピーク ≈0.975（クリップなし）を確認した上で
  L1 を実施した（無音区間 `0.05` ・中音量区間 `0.3` は契約どおり）。
- **音声コーデックは契約例の AAC ではなく MP3 を使用した**。理由: 検証で使用した Electron ビルドの
  `decodeAudioData` は AAC（`.m4a` 単体・動画コンテナ内の両方）を `EncodingError: Unable to decode audio data`
  で一律拒否する。単体 AAC/MP3/WAV、および H.264 映像 + MP3 音声を muxed した MP4 で個別に
  `decodeAudioData` を直接実行して確認済み（AAC のみ失敗、MP3/WAV/PCM は成功）。この Electron ビルドの
  `libffmpeg.dylib` が非プロプライエタリコーデック限定でビルドされていること（`npm run build` ログの
  "does not contain proprietary codecs" 表示）に起因すると推測される。実装コード自体の不具合ではなく、
  実際の配布物・別の Electron ビルドでは AAC が問題なく decode できる可能性がある。
- **波形生成（FileService 経由のバイト取得 → base64 往復 → `decodeAudioData`）の所要時間は、検証機の
  CPU 負荷状況により数秒〜約 5 分の幅で変動した**。直接呼び出し計測でも同一処理が実行タイミングにより
  大きくばらつくことを確認しており、実装のロジック自体に無限ループや無応答の不具合がある訳ではないことを
  タイミング計装で確認済み。検証ドライバ（`run-waveform-e2e.mjs`）のピクセル検出リトライ回数を
  40 回（20 秒）から waveform モード 360 回（180 秒）・fallback モード 180 回（90 秒）へ引き上げて対応した。

## 検証ドライバの調整（ラッパーによる検証スクリプト側の修正）

- ピクセル検出のリトライ回数を上記の理由で引き上げた（`retry(..., 'rendered cyan and orange waveform pixels', 360)` /
  `retry(..., 'fallback message pixels', 180)`）。
- 失敗時にソケットを閉じずプロセスが残留していた点を修正し、成功/失敗どちらの経路でも
  `process.exit()` するようにした（検証実行の後始末を確実にするため）。

## 再現手順

```sh
node extensions/akari-preview/evidence/preview-waveform/run-waveform-e2e.mjs \
  9333 <workspace> exports/sample.mp4 <evidence-dir> waveform
node extensions/akari-preview/evidence/preview-waveform/run-waveform-e2e.mjs \
  9333 <workspace> exports/no-audio.mp4 <evidence-dir> fallback
```

fixture 要件:

- `exports/sample.mp4`: 1280x720/24fps/20 秒、H.264 + MP3 音声（AAC は検証機の `decodeAudioData` が
  拒否するため MP3 を使用。音量エンベロープは無音 `0.05` → 大音量 `7.8`（実測ピーク ≈0.975）→
  中音量 `0.3`）
- `exports/no-audio.mp4`: 同じ映像パターンで `-an`（音声トラックなし）
- `exports/edit.json` / `exports/captions.json` / `exports/overlays/cap-a.html`: 回帰テスト
  （`run-transport-zoom-e2e.mjs`）用。`output.fps: 24`、overlay `cap-a`、caption はテスト全期間をカバー
- workspace 直下に `.akari/` ディレクトリが必須（既知の起動デッドロック回避）
