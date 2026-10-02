# CI 参考ジョブの起動修正

## 原因

- `gpu-export-soft-windows` の `run.json` 読み取り 2 箇所は、Git Bash の `$RUNNER_TEMP` を `node -p` / `node -e` の JavaScript ソース内に展開していた。Windows パスの `\` が JavaScript のエスケープとして解釈され、`require()` に渡るパスが壊れる。CI run `36984347044` では `Cannot find module 'D:a_temp/gpu-run-a/run.json'` が出た。
- golden soft の `run.mjs` は `esbuild/bin/esbuild` を `node` で起動していた。Linux の esbuild postinstall はこのパスをネイティブ実行ファイルに置き換えるため、Node が JavaScript として読むと `SyntaxError` になる。
- `gop-tail-seek.mjs` は同じパスを直接起動していた。Windows では JavaScript shim なので直接実行できず、さらに `.bin/electron` は Windows では `.cmd` である。

## 修正

- Windows 参考ジョブの該当 2 箇所だけで、`run.json` のパスを引用符付きのコマンド引数として渡し、`process.argv[1]` から読む。
- golden と seek の esbuild 起動を `build()` に変更する。両方とも元の `entryPoints`、`bundle: true`、`format: 'iife'`、`platform: 'browser'`、`target: 'chrome122'`、`outfile` を保つ。
- seek の Electron 実行ファイル選択を golden と揃え、Windows の `dist/electron.exe`、macOS の `dist/Electron.app/Contents/MacOS/Electron`、その他の `.bin/electron` の順にする。

## OS に依らない根拠

`process.argv[1]` は OS のパスを JavaScript ソースとして解釈しない。esbuild の JavaScript API はプラットフォームごとの実行ファイル選択をパッケージ側で扱う。Electron は Windows と macOS で実行ファイルを直接選び、Linux では従来どおり `.bin/electron` を使うため、CI の SwiftShader ラッパー経由の挙動を維持する。

## ラッパー実測

Windows 11 機・Node 24.20.0・Electron 39.8.7 でのラッパー実測。

| 項目 | 結果 |
|---|---|
| Windows 形式の `RUNNER_TEMP` で修正前の失敗 | `RUNNER_TEMP='C:\t\crj\a\_temp'`（Git Bash・GitHub の bash 既定 `-eo pipefail`）で Record ステップが `Cannot find module 'C:<TAB>crja_temp/gpu-run-a/run.json'` で exit 1、trap 最終行も同型で exit 1（CI の `D:a_temp` と同じ壊れ方）。 |
| 修正後の読み取り | 同じ `RUNNER_TEMP` で status=unsupported → exit 0・GITHUB_ENV `GPU_H264_ENCODER=no`・summary 出力。status=completed（360 フレームの mp4 2 本）→ exit 0・ffprobe 360・`MP4 SHA-256 matched`・`GPU_H264_ENCODER=yes`。trap 最終行: counters 全 0 → exit 0、readPixels=3 → exit 1、status=unsupported → exit 1（判定は弱まっていない）。 |
| Windows 参考ジョブ後半の実走 | `RUNNER_TEMP='C:\t\crj\r\_temp'` で fixture → soft 書き出し 2 回 → pre-encode SHA 360/360 一致 → Record（status=completed・ffprobe 360・MP4 SHA 一致）→ readback trap（counters 全 0）まで全ステップ exit 0（約 324 秒。`AKARI_EXPORT_ALLOW_DESKTOP=0`・`AKARI_EXPORT_GPU_PREFERENCE=off` で HKCU 無変更を確認）。 |
| golden の起動段 | 修正後、esbuild JS API の出力 renderer.js が修正前の CLI 出力と同一バイト（SHA-256 1754135…b8b6）。Electron（dist/electron.exe）が起動し results.json の assert 群は既定 GPU で全通過。その後 filter-compare.mjs で停止（下の 2）。修正前の Windows でも同じ地点で停止（Windows の bin/esbuild は JS シムなので修正前も起動段は通っていた）。 |
| Linux の esbuild 配置の模擬 | node_modules/esbuild/bin/esbuild を @esbuild/win32-x64 のネイティブ実行ファイルに差し替え（Linux の postinstall maybeOptimizePackage と同じ状態）→ 修正前の形 `node bin/esbuild …` は CI と同じ `SyntaxError: Invalid or unexpected token`。修正後の run.mjs / gop-tail-seek.mjs は同じ配置で同一バイトの bundle を作り、golden は filter-compare まで・seek は exit 0。差し替えは元に戻した。 |
| `gop-tail-seek.mjs` | 修正前は Windows で `spawnSync …\node_modules\esbuild\bin\esbuild ENOENT`。修正後は `npm run test:seek` そのままで exit 0（requestCount 94・finalFrameNumber 239）。gop-tail-seek-renderer.js は CLI 出力と同一バイト（728f005…84fc）。 |
| 単体テスト・drift | 修正前後とも 628 tests / 624 pass / 0 fail / 4 skip、check:frame-engine-drift 緑。 |
| YAML | js-yaml で構文 OK。ジョブ単位の深い比較で frame-engine-golden・frame-engine-golden-soft・osr-export-soft・gpu-export-soft とトップレベルは origin/main と同一、gpu-export-soft-windows の変更は 2 ステップ（Record・trap）の 1 行ずつだけ。 |

## 起動を直した後に残る赤（本票の範囲外・オーナー判断待ち）

- `filter-compare.mjs` が `render-cut --engine legacy` を呼ぶが、legacy 合成経路は 33e9250dd（2026-09-01・#130d）で撤去済みのため `--engine legacy は廃止されました` で exit 2。golden-soft は 2026-09-06（efcef0442）以降 esbuild の段で落ちていたので、この腐りが見えていなかった。比較相手（legacy の ffmpeg フィルタグラフ）が存在しないので、比較先を gpu / osr 出口に替えるか比較を廃止するかは設計判断（期待値の変更にあたるので本票では触らない）。
- SwiftShader（CI soft と同じ `--disable-gpu --enable-unsafe-swiftshader --use-angle=swiftshader`）で golden の Electron 段をこの機械で回すと、results の assert 104 文のうち 5 文が不合格: results.pass・colorPatches.pass・colorPatches.direct.pass（direct 9 行中 6 行が Δ最大 12。例 red 期待 [255,0,0] 実測 [255,1,3]、blue [0,0,255] 実測 [1,0,243]）・frameLifetime.pass・frameLifetime.decodeQueueSizeFinal（28、期待 0）。colorPatches はワークフローのコメントが言う「SwiftShader では許容差が未定義で Δ1〜12」の既知事項で、2026-09-03・09-05 の CI でも run.mjs の results.pass で落ちていた。frameLifetime の decodeQueueSizeFinal はこの機械の SwiftShader での観測（CI Linux で再現するかは未確認）。
- 結論: 本票の修正で golden-soft は「起動の段」を越えるが、上の 2 点が残るため CI で緑にはならない見込み。gpu-export-soft-windows は修正したステップの後に既知の失敗は無い。
