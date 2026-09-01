# main プロセス stderr / webview console の抜粋（merge 後 HEAD の L1 走）

元ファイルは `after/*-electron.log`。リポジトリの `.gitignore` が `*.log` を無視するため、
契約が要求する「renderer コンソール・main プロセスの stderr」を追跡可能な形でここに写した。
絶対パスは `<WORKTREE>` / `<SCRATCH>` / `<TMPDIR>` へ置換済み。

## 集計（両走とも SyntaxError 0 / Uncaught 0）

| 走 | Theia 形式 ERROR | Chromium 形式 :ERROR: | SyntaxError | Uncaught |
|---|---|---|---|---|
| objtree | 0 | 1 | 0 | 0 |
| critique | 1 | 1 | 0 | 0 |

### ERROR 行の中身（全 3 行）

```
[objtree] [25735:0901/133227.212819:ERROR:sandbox/mac/system_services.cc:35] SetApplicationIsDaemon: Error Domain=NSOSStatusErrorDomain Code=-50 "paramErr: error in user parameter list" (-50)
[critique] [26325:0901/133300.653356:ERROR:sandbox/mac/system_services.cc:35] SetApplicationIsDaemon: Error Domain=NSOSStatusErrorDomain Code=-50 "paramErr: error in user parameter list" (-50)
[critique] 2026-09-01T04:33:16.330Z root ERROR [webview: akari-output-preview-xomqmp] [akari-three] 3D scene の読み込みに失敗しました { isTrusted: true }
```

- `SetApplicationIsDaemon`（Chromium sandbox）は両走に 1 行ずつ。macOS 固有の起動時ノイズでプレビューと無関係
- `[akari-three] 3D scene の読み込みに失敗しました` は critique-cut-v2 の 3D オーバーレイ（`overlays/3d-laptop`）由来。
  **main 単体の対照群でも同じ行が出る**（`after/control-main-only.json`）ため本レーンの持ち込みではない。
  捕捉済みエラーで `unhandledExceptions` は 0、再生・シークは継続する = fail-open が成立している側の実例。**別票候補として申し送る**

## objtree（webview / frame-engine 関連行）

```
111:2026-09-01T04:32:27.575Z root INFO [webview: akari-output-preview-sl9p40] @webav version: 1.2.8, date: 2026/9/1
112:2026-09-01T04:32:27.576Z root INFO [webview: akari-output-preview-sl9p40] Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) @akari-video/shell/0.1.31 Chrome/142.0.7444.265 Electron/39.8.7 Safari/537.36
113:2026-09-01T04:32:27.694Z root WARN [webview: akari-output-preview-sl9p40] [frame-engine] http://127.0.0.1:52545/media/5aec464208ed02a2f28cf46bd1cd404296ddcf7f171294fa6030c6764d7544e4: this host does not support byte ranges; loading the full source once
114:2026-09-01T04:32:27.924Z root WARN [webview: akari-output-preview-sl9p40] [frame-engine] http://127.0.0.1:52545/asset/2944270e4d86aa727b578f4c731f9d35a69c5f25dc64bc4d7883a013bf7bc56d: this host does not support byte ranges; loading the full source once
115:2026-09-01T04:32:27.926Z root WARN [webview: akari-output-preview-sl9p40] [frame-engine] http://127.0.0.1:52545/media/af67b1fbc1aa927b14d7dd766be23e6dd85a2e37f84e910e46a378c845c2e825: this host does not support byte ranges; loading the full source once
120:2026-09-01T04:32:37.234Z root WARN [webview: akari-output-preview-sl9p40] [frame-engine] a:cut-0: target 300000us was not produced; reseeking from sync once
```

## critique（webview / frame-engine 関連行）

```
109:2026-09-01T04:33:01.210Z root INFO [webview: akari-output-preview-xomqmp] @webav version: 1.2.8, date: 2026/9/1
110:2026-09-01T04:33:01.210Z root INFO [webview: akari-output-preview-xomqmp] Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) @akari-video/shell/0.1.31 Chrome/142.0.7444.265 Electron/39.8.7 Safari/537.36
112:2026-09-01T04:33:01.485Z root WARN [webview: akari-output-preview-xomqmp] [frame-engine] http://127.0.0.1:52597/media/c57c80e1caae926247623a47e650ca4c2dab017ad4c5a3f552685307d4437b1c: this host does not support byte ranges; loading the full source once
113:2026-09-01T04:33:02.036Z root WARN [webview: akari-output-preview-xomqmp] [frame-engine] http://127.0.0.1:52597/media/9dcd976982011967cbe96484c0ca9aaf5e3af22768b4dcf03af65195989343e6: this host does not support byte ranges; loading the full source once
117:2026-09-01T04:33:16.330Z root ERROR [webview: akari-output-preview-xomqmp] [akari-three] 3D scene の読み込みに失敗しました { isTrusted: true }
```

