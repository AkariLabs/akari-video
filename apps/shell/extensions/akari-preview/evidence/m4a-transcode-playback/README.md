# evidence: m4a-transcode-playback（2026-07-22-m4a-transcode-playback）

L1 実機検証（Electron + 生 CDP WebSocket クライアント。手法は
`evidence/audio-file-open/README.md`（Wave 25）の
`Target.attachToTarget` + `Page.createIsolatedWorld` による
入れ子 webview フレーム到達法を再利用）。

## 手法

- ビルド: `npm run build`（`build:ext` + `theia build --mode production`）exit 0
- 隔離ワークスペース: `templates/project-default/` を作業用一時ディレクトリへコピーし、
  `assets/audio-test/` に ffmpeg で合成した検証素材を追加（`test-tone.m4a` / `test-tone.aac`
  / `test-tone.wav` / `test-tone.mp3`（いずれも 440Hz サイン波・5秒）、
  `broken.m4a`（拡張子だけ m4a・中身は平文テキスト、61B)）
- 起動: `<WORKTREE>/apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
  <apps/shell> <隔離ワークスペース> --remote-debugging-port=<port>
  --user-data-dir=<隔離ディレクトリ> --no-sandbox`
- ファイルオープン: `window.theia.container._bindingDictionary._map` から `CommandRegistry` を
  特定し `commands.executeCommand('vscode.open', 'file://' + <絶対パス>)` を実行
  （Wave 25 と同一の着地点）
- 入れ子 webview フレーム到達: `Target.getTargets` で `akari-audio-<hash>` を含む iframe
  ターゲットを特定し `Target.attachToTarget({flatten:true})` → `Page.getFrameTree` で
  `active-frame` 子フレームを特定 → `Page.createIsolatedWorld` で実行コンテキストを取得し
  `Runtime.evaluate` で `<audio>` の実 DOM 状態を読む。Theia はフォーカス中のタブの
  webview iframe のみを CDP ターゲットとして保持する（背面タブは一時的にターゲット一覧から
  外れる）ため、対象ファイルを毎回 `vscode.open` で再オープン/再アクティブ化してから評価する
  ことで安定して同一ウィジェットへ到達した
- 再生開始の実測: 上記コンテキストで `document.getElementById('audio').play()` を呼び、
  `paused` が `true→false` に遷移し `currentTime` が進むことを確認

## 測定結果

### m4a（変換経路、正常系）

`test-tone.m4a`（AAC-LC 128kbps/5秒/78.7KB）を開く: ダイアログ **0/0**。
プレーヤーカード表示（実尺 `0:05`・サイズ `78.7 KB`・「ffmpeg 変換で再生中」の注記）。
`<audio>.duration = 5.01551`（バックエンドで wav に変換後、`createAssetStream` と同じ
HTTP ストリーミング配信で `<audio>` に渡している）。
`play()` 実行後、800ms 時点で `paused:false, currentTime:0→0.043461`、
3秒間の継続再生でも `currentTime` が `0→1.001415→2.507701` と単調に進行し、
`audio.error` は最後まで `null`（前回ラウンドで発見した早期一時ファイル削除バグの
修正確認を兼ねる）。スクリーンショット: `01-m4a-playing.png`

### aac（変換経路、正常系）

`test-tone.aac`（AAC-LC 128kbps/5秒/78.5KB、ADTS 生ストリーム）を開く: ダイアログ 0/0。
`<audio>.duration = 5.03873`。3秒間の継続再生で `currentTime` が `0→1.408088→2.913185`
と進行、`audio.error` は `null`。スクリーンショット: `02-aac-playing.png`

**修正の経緯（重要）**: 初回実装では `.aac` の変換後再生中に
`PipelineStatus::PIPELINE_ERROR_READ: FFmpegDemuxer: data source error`
（`audio.error.code === 2`）が実機で再現した。原因はバックエンドの HTTP 配信ハンドラが
「range リクエストがファイル末尾まで届いた最初のレスポンス」を消費完了とみなして
一時 wav ファイルを即座に削除していたため、`<audio>` 要素が行う複数回の
byte-range リクエストの後続分が 404 になっていたこと。ウィジェット破棄
（タブクローズ）に一時ファイルの削除を紐付ける方式（既存の `disposeAssetStream` と
同じ流儀）に修正し、上記の 3 秒間再生で無エラーを再確認した。

### 壊れた m4a（劣化カード）

拡張子は `.m4a` だが中身が平文テキストの `broken.m4a`（61B）を開く: ダイアログ 0/0、
日本語劣化カード（「このファイルはアプリ内で再生できません。」+ `broken.m4a` +
`サイズ: 61 B`）を実測。スクリーンショット: `03-broken-m4a-degraded.png`

### ffmpeg 不在（劣化カード）

システム `ffmpeg` が解決できない環境（zsh の `ZDOTDIR` を検証用にサンドボックスし、
`PATH` から実 ffmpeg を含むディレクトリを除外。ユーザーの実 dotfiles・システムの
実 ffmpeg バイナリは一切変更していない）で `test-tone.m4a` を開く: ダイアログ 0/0、
日本語劣化カード「このファイルはアプリ内で再生できません。**再生には ffmpeg が必要です。**」
（契約が要求する文言を含む）を実測。スクリーンショット: `04-ffmpeg-not-found-degraded.png`

### 変換タイムアウト（劣化カード）

`PATH` 先頭に「起動後 SIGKILL されるまで無応答で待ち続ける」偽 `ffmpeg` スクリプトを
仕込んだ環境（同じく `ZDOTDIR` サンドボックスのみで実現。システムの実 ffmpeg は無変更）で
`test-tone.m4a` を開き、ファイルオープンから偽 ffmpeg プロセスが消滅するまでの時間を
壁時計で実測: **ちょうど 30 秒**（実装の `TRANSCODE_TIMEOUT_MS = 30_000` と一致）。
プロセスは `SIGKILL` で確実に終了し、その後 UI は日本語劣化カード
「このファイルはアプリ内で再生できません。」に落ちることを確認（ダイアログ 0/0）。
スクリーンショット: `05-timeout-degraded.png`

### 非退行（wav / mp3、直接経路のまま）

- `test-tone.wav`（PCM 16bit/44.1kHz/mono/5秒/431KB）: ダイアログ 0/0、
  プレーヤーカードの `data-playback-path` 属性が `"direct"`、`<audio>.currentSrc` が
  `data:audio/wav;base64,...`（変換経路の HTTP ストリーム URL ではない）であることを確認。
  `play()` 後 `currentTime` が `0→0.707699` へ進行。スクリーンショット: `06-wav-non-regression.png`
- `test-tone.mp3`（128kbps/5秒/79KB）: 同様に `data-playback-path="direct"`、
  `currentSrc` が `data:audio/mpeg;base64,...`。`play()` 後 `currentTime` が
  `0→0.724493` へ進行。スクリーンショット: `07-mp3-non-regression.png`

いずれも「ffmpeg 変換で再生中」の注記は表示されず、変換経路を通っていないことを確認した。

### 一時ファイルの残置なし

- 変換ストリームは対応するウィジェット（タブ）が破棄されるまで一時ファイルを保持し
  （再生中に消えないことを 3 秒間の継続再生で確認済み — 上記 m4a/aac 節参照）、
  タブを閉じる操作（`lm-TabBar-tabCloseIcon` への pointerdown/pointerup/click）を行うと
  ただちに一時ファイル・一時ディレクトリが削除されることを、OS の tmpdir
  （`akari-audio-*` prefix のディレクトリ）の前後比較で実測した
- ffmpeg 不在・タイムアウト・変換失敗の各エラー経路でも、一時ディレクトリ
  （`mkdtemp` で作成済みのもの）がエラー処理内で確実に削除されることを、
  各シナリオ実行後の tmpdir 走査（0 件）で確認した
- 複数回の Electron 起動・強制終了（タブを閉じずに `kill` したケースを含む）を跨いだ後の
  最終確認でも、`akari-audio-*` prefix の一時ディレクトリは tmpdir 上に 0 件だった

## 検証専用フィクスチャについて

隔離ワークスペース・合成音声素材（m4a/aac/wav/mp3/broken）・生 CDP クライアントスクリプトは
本評価専用であり、リポジトリには含めていない（scratchpad 内で作成・使用後に完結）。
ffmpeg 不在・タイムアウトの検証で用いた「偽 ffmpeg」「zsh ZDOTDIR サンドボックス」も
同様に検証専用の一時ファイルであり、ユーザーの実システム（dotfiles・実 ffmpeg バイナリ）は
一切変更していない。
