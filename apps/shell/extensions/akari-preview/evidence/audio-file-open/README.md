# evidence: audio-file-open（2026-07-21-audio-file-open）

L1 実機検証（Electron + 生 CDP WebSocket クライアント。`node --version` の native `WebSocket` を使用。
playwright-core は接続確認・`page.evaluate` によるダイアログ検知/コマンド実行のみに使い、
webview 内側フレームの DOM 到達は生 CDP に切り替えた — 詳細は「手法」節）。

## 手法

- ビルド: `npm run build`（`build:ext` + `theia build --mode production`）exit 0
- 隔離ワークスペース: `templates/project-default/` をコピーし、`assets/audio-test/` に合成素材を追加
  （ffmpeg 生成: `test-tone.wav`（PCM 16bit/44.1kHz/mono/5秒/431KB）、
  `test-tone.mp3`（MP3 128kbps/5秒/79KB）、`test-tone.m4a`（AAC-LC 128kbps/5秒/79KB）、
  `broken.wav`（拡張子 .wav だが中身は平文テキスト、83B）、
  `large-test.wav`（PCM 16bit/44.1kHz/stereo/6分/60.6MB、上限 50MB 超過用）、
  `clip.mp4`（640x360/3秒/H.264、非退行確認用）、`frame.png`（320x180、非退行確認用））
- 起動: `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell> <隔離ワークスペース>
  --remote-debugging-port=<port> --user-data-dir=<隔離ディレクトリ> --no-sandbox`
- ファイルオープンの実行: `window.theia.container._bindingDictionary._map` を走査し、
  プロトタイプに `executeCommand`/`registerCommand` を両方持つコンストラクタ（`CommandRegistry`。
  production ビルドでは識別子名が `Rct` 等に短縮されるため名前でなくメソッド指紋で特定）を
  `container.get()` して `commands.executeCommand('vscode.open', 'file://' + <絶対パス>)` を実行
  （F22 調査結論どおり、follow-open と同じ `OpenerService` 経由の着地点）
- 入れ子 webview フレームへの到達: Theia の `WebviewWidget` は `<webview>` タグではなく
  `http://<hash>.webview.localhost:<port>/webview/index.html` を指す実 `<iframe>`
  （CDP 上は `type: "iframe"` の**独立ターゲット**として現れる — Electron 39 / Chromium 142 で
  OOPIF 化されている）。`Target.getTargets` で該当ターゲットを特定し
  `Target.attachToTarget({targetId, flatten:true})` で個別セッションを確立、
  さらにその内部の `active-frame` という名前の子フレーム（同一オリジンだが
  `Runtime.executionContextCreated` イベントは attach 前に発火済みでレースする）に対し
  `Page.createIsolatedWorld({frameId, grantUniveralAccess:true})` で決定的に実行コンテキストを
  取得し、そこへ `Runtime.evaluate` して `<audio>`/`<img>`/`<video>` の実 DOM 状態を読む
  （playwright-core の `page.frames()`/`frame.evaluate()` はこの OOPIF 構成を辿れず失敗することを
  確認済み — 生 CDP 必須。この点は既存の `evidence/seek-and-image-open/README.md` の知見と一致）
- 再生開始の実測: 上記コンテキストで `document.getElementById('audio').play()` を呼び、
  `paused` が `true→false` に遷移し `currentTime` が進むことを確認

## 測定結果

### wav（正常系）

`test-tone.wav` を開く: ダイアログ 0/0、プレーヤーカード表示（ファイル名・実尺 `0:05`・
サイズ `430.7 KB`）。`<audio>` 要素: `duration=5`（メタデータロード成功）。
`play()` 実行後 `paused=false`、`currentTime` が `0→0.221062` へ進行（再生開始を実測）。
スクリーンショット: `01-wav-playing.png`

### mp3（正常系）

`test-tone.mp3` を開く: 同様にダイアログ 0/0、プレーヤーカード表示（実尺 `0:05`・サイズ `79.2 KB`）。
`duration=5`。`play()` 後 `paused=false`、`currentTime` が `0→0.543461` へ進行。
スクリーンショット: `02-mp3-playing.png`

### m4a（重要な既知の環境制約 — 下記「未確認事項」参照）

`test-tone.m4a` を開く: ダイアログは **0/0**（英語警告は出ない。F22 由来の OpenHandler 優先度
1100 は正しく機能）。ただし `<audio>` の `error` イベントが実際に発火し、実装仕様どおり
日本語劣化カード（「このファイルはアプリ内で再生できません。」+ ファイル名 + サイズ）に
自動的に切り替わることを確認（`errorCardHidden:false, playerCardHidden:true`）。
スクリーンショット: `03-m4a-degraded-codec-unsupported.png`

根本原因を切り分けるため、`Audio()` に `data:audio/mp4;base64,...` /
`data:audio/aac;base64,...` 等の複数 MIME 文字列で同じ m4a ファイルを直接ロードするテストを
実施したところ、いずれも `MediaError.code=4`
（`PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams`）
で失敗（`-movflags +faststart` で `moov` atom を先頭に移動させた別ファイルでも同結果、
container 構造の問題ではないことを確認）。`apps/shell` のビルドパイプラインが依存する
`@theia/ffmpeg` パッケージのソース（`node_modules/@theia/ffmpeg/lib/check-ffmpeg.js`）を確認したところ、
`KNOWN_PROPRIETARY_CODECS = new Set(['h264', 'aac'])` として **aac を非対応（プロプライエタリ
コーデック除外方針）として明示的に列挙**しており、`npm run build` の prebuild ステップでの
ffmpeg ライブラリ検証ログにも `"...libffmpeg.dylib" does not contain proprietary codecs (13 found)`
という警告が実際に出力されている（本 evidence 冒頭のビルドログで確認可能）。
一方 mp4/H.264 の動画プレビューは実際に再生できている（`06-mp4-non-regression.png` および
下記「非退行」節、`duration=3, readyState=4` で完全デコード済み）。これは H.264 が
macOS では VideoToolbox 経由のハードウェアデコードパスを使え `libffmpeg` のコーデック表から
独立して動作する一方、音声の AAC デコードには同等のプラットフォームデコードパスが
Chromium の音声パイプラインに存在しない（ソフトウェアデコードのみ）ためと考えられる。
MP3（特許失効済み・プロプライエタリコーデック扱いされない）や WAV（無圧縮）が
正常に再生できることも、この仮説と整合する。

**結論: これは `AkariAudioOpenHandler` の実装不備ではなく、`apps/shell` のビルドパイプラインが
意図的に AAC/H.264 コーデックをライセンス上の理由で `libffmpeg` から除外している
既存の・本タスク以前からのプラットフォーム制約である。** m4a を開いたときに英語警告が出ず
日本語劣化カードへ正しく自動的にフォールバックすること自体は実装仕様（契約の劣化規約 §2）
どおりであり、その意味では「壊れた/読めないファイルの劣化パス」は m4a でも実測・確認できている。
ただし「実尺 > 0 かつ再生開始」という**成功パス**の実測は、この検証環境（および恐らく
配布物も含む全ての `apps/shell` Electron ビルド共通）では AAC 非対応のため原理的に不可能。

### 壊れたファイル（劣化カード）

拡張子 `.wav` だが中身が平文テキストの `broken.wav` を開く: ダイアログ 0/0、
日本語劣化カード（「このファイルはアプリ内で再生できません。」+ `broken.wav` + `サイズ: 83 B`）を実測。
スクリーンショット: `04-broken-wav-degraded.png`

### 上限超過ファイル（劣化カード、方式 (a) 採用のため必須）

60.6MB（50MB 上限超過）の `large-test.wav` を開く: ダイアログ 0/0、日本語劣化カード
（「大きすぎるためアプリ内で再生できません。」+ `large-test.wav` + `サイズ: 60.6 MB`）を実測。
`FileService.resolve` のメタデータ段階でガードが効き、`readFile` 自体は発生しない設計どおりの
挙動を確認。スクリーンショット: `05-oversize-degraded.png`

### 非退行（mp4 / png）

- `clip.mp4`（H.264/640x360/3秒）: ダイアログ 0/0、動画プレビューウィジェットが開き
  `<video>` の `duration=3, readyState=4`（完全デコード）を実測。
  スクリーンショット: `06-mp4-non-regression.png`
- `frame.png`（320x180）: ダイアログ 0/0、画像ビューワが開き `<img>` の
  `naturalWidth=320, naturalHeight=180, complete=true` を実測。
  スクリーンショット: `07-png-non-regression.png`

いずれも `AkariAudioOpenHandler` 追加（拡張子ベースの `canHandle`、音声拡張子のみ claim）による
既存ハンドラへの影響が無いことを確認。

## 未確認事項（このディレクトリに関するもの）

- **m4a（および同じ AAC コーデックを使う .aac 拡張子）の実再生（`duration>0` + 再生開始）は
  本検証環境で実測不能**（上記「m4a」節の技術的根拠を参照）。原因はこのタスクの実装ではなく
  `apps/shell` の `@theia/ffmpeg` 除外ポリシー（`h264`/`aac` をプロプライエタリコーデックとして
  明示的に除外）という、本タスクのファイル境界外・既存のビルドパイプライン制約。
  劣化パス（英語警告が出ず日本語カードに落ちる）自体は m4a でも実測済み
- `.aac` 拡張子は m4a と同じ AAC コーデックを使うため同様の制約が推測されるが、個別のファイルでの
  実測はコスト対効果を鑑み実施していない（m4a で確認した `DEMUXER_ERROR_NO_SUPPORTED_STREAMS` の
  原因が拡張子ではなくコーデックであることは MIME 文字列を変えた追試で確認済み）
- `.flac` / `.ogg` / `.oga` / `.opus` の実再生は本 evidence では個別実測していない
  （wav = 無圧縮 PCM、mp3 = 特許失効コーデックの 2 系統で `<audio>` + data URI 経由の
  デコード・再生パイプライン自体が機能することは実測済み。flac/ogg/opus はいずれも
  royalty-free コーデックで `KNOWN_PROPRIETARY_CODECS` に含まれないため同様に動作する見込みだが、
  契約の受け入れ条件が明示するのは wav/mp3/m4a の 3 形式のみのため範囲外とした）

検証専用の隔離ワークスペース・生成素材（wav/mp3/m4a/mp4/png、大容量ファイル含む）は
本評価後に完全削除した（リポジトリには含めていない）。
