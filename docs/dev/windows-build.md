# Windows 実機ビルド手順書（Tier 0）

AKARI Video のシェル（`apps/shell`、Theia + Electron）を Windows 実機でビルド・パッケージ・
起動するための実行チェックリスト。上から順にコピペで実行できる。

対象読者: Windows 実機（x64 を想定。ARM64 機の場合は各所の `x64` を `arm64` に読み替え）で
初めてこのリポジトリをビルドする人。

> 背景: ビューワーはネイティブ実装ではなく Electron/Chromium の `<video>` + WebCodecs
> なので、**新規のネイティブビューワー実装は不要**。macOS 依存が残っているのはパッケージング
> 周辺スクリプトのみで、本書はその上で「実際に Windows でビルドが通るか」を検証する手順。

## 前提チェック

- [ ] **Node.js**: リポジトリの実態に合わせて **26.3.0**（`.github/workflows/ci.yml` が
      `node-version: '26.3.0'` を固定使用。ローカル開発機の実測も v26.3.0）。
      [nodejs.org](https://nodejs.org/) の Windows x64 インストーラ、または
      `winget install OpenJS.NodeJS` で導入
- [ ] **git**: 通常のインストーラでよい。ただしリポジトリ直下に **git 管理の symlink が
      複数存在する**ため、`git clone` の前に以下のいずれかを行うこと（未対応のまま clone
      すると symlink がテキストファイル化して壊れる — 既知の未対応事項、後述）:
      - Windows 10 1703+ で「開発者モード」を有効化してから
        `git config --global core.symlinks true` を設定して clone、または
      - 管理者権限のシェルで clone（symlink 作成に特権が要る環境向けの代替）
- [ ] **Visual Studio Build Tools + Python 3.x + Spectre 軽減ライブラリ（事実上必須）**:
      当初「基本的に不要」としていたが、Windows 実機検証で必須と確定（issue #6 / #8。
      drivelist の prebuilt 配布が v6.4.3 で停止しており〔v11 以降は GitHub Releases の
      assets が空〕、全 Windows 実機で node-gyp のソースビルドに落ちるため）。
      GitHub の windows ランナーには標準搭載のため CI では顕在化しない:
      - Visual Studio Installer →「C++ によるデスクトップ開発」ワークロード
      - 個別コンポーネント「**MSVC v143 - VS 2022 C++ x64/x64 Spectre 軽減ライブラリ
        （最新）**」— 無いと theia build / package が MSB8040 系で失敗する
        （切り分けが難しい死に方をする。後述トラブルシュート参照）
      - Python 3.x（[python.org](https://www.python.org/) または
        `winget install Python.Python.3.12`）
- [ ] **長いパスの有効化（推奨・issue #6）**: 管理者 PowerShell で
      ```powershell
      New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
        -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
      ```
      git の `core.longpaths` とは**別物**。無効のままでも正常ビルドは通り得るが、
      依存ツリーが壊れてネストが深くなった場合に node_modules が MAX_PATH 260 を超えて
      削除不能になる（後述トラブルシュート参照）

### ネイティブモジュールの扱い（実地調査済み・2026-07-23）

このリポジトリのネイティブ依存（`node-pty` / `drivelist` / `keytar` /
`msgpackr-extract` / `@parcel/watcher`）は全て **prebuild-install 系または
npm optionalDependencies 系**の仕組みで配布されている。実地確認した結果:

| パッケージ | 用途 | win32-x64 の入手経路 |
|---|---|---|
| `node-pty` | ターミナル（PTY） | npm パッケージ本体に `prebuilds/win32-x64/{conpty,conpty_console_list}.node` を**同梱**（ダウンロード不要） |
| `drivelist` | ドライブ一覧 | `install` スクリプトが `prebuild-install --runtime napi` を先に試行するが、**v12 系に prebuilt が存在しない**（GitHub Releases の配布は v6.4.3 が最後・v11 以降 assets 空）→ **必ず node-gyp ソースビルド**（issue #6 実機確定） |
| `keytar` | 資格情報保存 | `prebuild-install \|\| npm run build` |
| `msgpackr-extract` | msgpack 高速化 | `node-gyp-build-optional-packages`（npm optionalDependencies 経由の prebuilt バイナリ） |
| `@parcel/watcher` | ファイル監視（Theia が使用） | `optionalDependencies` に `@parcel/watcher-win32-x64` / `-win32-arm64` を明記。npm が自動選択 |

当初（2026-07-23 の机上調査）は「通常はコンパイラ無しで完了する見込み」としていたが、
**Windows 実機検証（2026-07-27・issue #6）で否定された**: drivelist が必ずソースビルドに
落ちるため、`npm install` には VS Build Tools + Python + LTO 無効化 env（ビルド手順参照）が
事実上必須。加えて `npm run package`（@electron/rebuild の node-pty 再ビルド）には
Spectre 軽減ライブラリも要る（issue #8）。

**Electron 向け ABI 変換について**: `apps/shell/package.json` の `build.npmRebuild` は
未設定（electron-builder のデフォルト `true`）のため、`npm run package`
（= `electron-builder --dir` 経由）実行時に **`@electron/rebuild` が自動的に全ネイティブ
モジュールを Electron 39.8.7 の ABI に合わせて検証・再取得する**（`npm install` 時点の
ホスト Node.js の ABI とは別物）。これは electron-builder 自体の標準動作で、本タスクでの
追加設定は不要（mac 上での cross-build 検証で `@electron/rebuild` の実行自体は確認済み。
mac→win のクロスコンパイルは node-gyp の制約で失敗するが、これは mac 実機固有の制約で
Windows 実機では起こらない）。

## ビルド手順

すべて `apps/shell/` をカレントディレクトリとして実行する。

```powershell
cd apps\shell

# 1. 依存インストール（package-lock.json は意図的に .gitignore 対象 — CI と同じ理由で
#    apps/shell 単体を --no-workspaces でインストールする。`npm ci` は使えない
#    （ロックファイルが無いため）。CI と異なり --ignore-scripts は付けない
#    （実機ビルドにはネイティブモジュールの実体が必要なため）
#
#    LTO 無効化は必須（issue #6）: Windows 公式 node.exe は ClangCL + thin LTO ビルドで、
#    node-gyp が process.config を写すため全ネイティブアドオンのリンクに
#    /opt:lldltojobs=2 が注入され、MSVC link.exe が LNK1117 で失敗する。drivelist は
#    prebuilt が無く必ずソースビルドになるので、この env は全 Windows 実機で必要
#    （CI windows-build.yml と同じ回避）
$env:npm_config_enable_lto = 'false'
$env:npm_config_enable_thin_lto = 'false'
npm install --no-workspaces

# 1b. electron 実体の確認と直接配置（issue #7）: Node 24 以降の Windows では electron の
#     postinstall が zip 展開（extract-zip → yauzl）の read stream 停止により
#     「無音 exit 0」し、node_modules\electron\dist が生成されないことがある。
#     このまま進むと theia build が一見無関係なエラーで死ぬため、ここで dist を確認し、
#     無ければ公式リリース zip を直接配置する（CI windows-build.yml と同じ手当て。
#     ARM64 機は zip 名の x64 を arm64 に読み替え）
if (-not (Test-Path node_modules/electron/dist/electron.exe)) {
  $v = node -p "require('./node_modules/electron/package.json').version"
  curl.exe -sSL -o electron.zip "https://github.com/electron/electron/releases/download/v$v/electron-v$v-win32-x64.zip"
  if (Test-Path node_modules/electron/dist) { Remove-Item -Recurse -Force node_modules/electron/dist }
  Expand-Archive electron.zip -DestinationPath node_modules/electron/dist -Force
  Remove-Item electron.zip
  Set-Content -NoNewline node_modules/electron/path.txt "electron.exe"
}
node -e "require('fs').accessSync('node_modules/electron/dist/electron.exe'); console.log('electron.exe OK')"

# 2. 拡張のビルド（TypeScript, 9 拡張）
npm run build:ext

# 3. Theia 本体ビルド（production mode）
npm run build

# 4. パッケージング（--dir ターゲット = インストーラ無し・展開済みディレクトリのみ。
#    NSIS 等の配布形式は第 2 陣で扱う・本書の範囲外）
npm run package
```

`npm run package` は内部で次の順に走る（`package.json` の npm ライフサイクルフック）:
`prepackage`（`copy-native-helpers.mjs` — overlay-runtime / skills / schemas /
project-default テンプレートの同梱。win32 では node-pty 用の追加コピーは無し・理由は
上表のとおり `.node` ファイルのみで足りるため / `patch-ripgrep-asar-path.mjs` —
バンドルの rgPath を asar.unpacked 対応へパッチ〔issue #5〕）→ `electron-builder --dir --win`
（自動で `@electron/rebuild` → ファイルコピー → asar 生成）→
`postpackage`（`verify-asar-contents.mjs` — 拡張 9 本・skills・schemas・
project-default テンプレート・node-pty の win32 ネイティブモジュールが
`electron-builder-out/win-unpacked/resources/app.asar` に同梱されているか、
および ripgrep が `app.asar.unpacked` 側に unpack され rgPath パッチが適用されて
いるか〔issue #5〕を検証。「配布はブロックしないがサイズ目安 1536MB 超で警告」も参照）。

成功すると `apps\shell\electron-builder-out\win-unpacked\AKARI Video.exe` ができる。

## Tier 0 検証チェックリスト

- [ ] `electron-builder-out\win-unpacked\AKARI Video.exe` をダブルクリックで起動できる
      （**未署名ビルドのため SmartScreen 警告が出る** — 既知の未対応事項、後述。
      「詳細情報」→「実行」で続行）
- [ ] 起動後、アプリの「はじめる」画面からプロジェクトを新規作成、または既存プロジェクト
      フォルダを開ける（プロジェクトは単なるフォルダ + `.akari/events` 配下のイベントログ。
      特別なインストール手順は無い）
- [ ] 動画ファイルを 1 本読み込み、プレビューでネイティブ再生できる（Chromium `<video>` +
      WebCodecs 経由。H.264 素材で確認。HEVC は既知の未対応事項を参照）
- [ ] タイムラインにクリップのサムネイル・波形が表示される（`ffmpeg` 経由。表示されない場合は
      直下の「ffmpeg 導入」を先に実施してからアプリを再起動。波形は**素材に音声ストリームが
      ある場合**にクリップ下端の帯として描画される。audio トラック側の波形は `edit.json` の
      `audio.sfx` に wav/mp3 を 1 本置くと確認できる — issue #9 の切り分けより）
- [ ] **ffmpeg 導入**: サムネイル/波形生成・音声プレビュー変換は `ffmpeg` が **PATH 上に
      あること**が前提（バンドルされたバイナリは無い。存在チェックのみでバージョン要件は
      無い）。未導入の場合:
      ```powershell
      winget install "Gyan.FFmpeg"
      ```
      導入後は新しいターミナル/アプリ再起動が必要（PATH 反映のため）。`ffmpeg` が見つからない
      場合、アプリ側は機能を静かに無効化するだけでクラッシュはしない
      （「ffmpeg が見つからないため、サムネイルと波形は表示されません」の通知が出る設計）

## 既知の未対応事項（正直に）

- **HEVC デコード**: 実機の GPU/OS コーデック拡張に依存する。Windows は「HEVC Video
  Extensions」が既定で入っていない構成が多く、その場合は完全にデコード不能（ソフトウェア
  フォールバックの抜け道は無い見込み）。H.264 → プロキシ変換によるフォールバックは
  第 2 陣で設計済み・未着手（内部リポの windows-port 設計計画を参照）
- **フォント見た目差**: テロップは現状 OS フォントフォールバック（Yu Gothic 等）に依存し、
  Mac の見た目と差が出る。「壊れないが見た目が変わる」状態。Noto Sans JP 同梱は第 2 陣で
  設計済み・未着手
- **codex/claude CLI 連携（akari-partner 拡張）**: `claude` が PATH にある環境は
  **Windows 実機で動作確認済み**（issue #9 — 右ペイン PTY で CLI の信頼確認プロンプト
  まで到達。conpty / node-pty prebuilt で動作）。CLI 未導入時の自動取得（bootstrap）は
  win32 分岐の実装済み・実機未検証（旧記述「win32 では例外を投げる」は bootstrap
  実装前の情報で、issue #9 の実機確認を受けて更新）
- **署名なし配布 → SmartScreen 警告**: コード署名していないため、初回起動時に Windows
  SmartScreen の警告が出る。配布用の署名・NSIS インストーラ化は「配布系」として本書のスコープ外
  （第 2 陣以降の課題）
- **render-cut の Chrome/Playwright 解決**: `packages/render-cut` の Chrome 実行ファイル
  探索ロジックは darwin 判定の分岐が macOS ハードコードで、win32 は Linux 向けの分岐に
  フォールスルーする（Playwright キャッシュのパス・バイナリ名パターンが Windows と
  不一致になる見込み）。`CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` 環境変数を明示すれば
  回避できる可能性が高いが未検証。`packages/render-cut/**` は本タスクの編集禁止領域
  （並行タスク `win-render-cut` が対応予定・現状 待機中）
- **絶対パス判定**: 素材/音声ソースの絶対パス判定が `startsWith('/')` 前提の箇所があり、
  `C:\...` 形式のパスでは機能しない可能性がある（`akari-preview-open-handler.ts`。
  `apps/shell/extensions/**` は本タスクの編集禁止領域）
- **`npm test`（`node --test test/*.mjs`）**: シェルの glob 展開に依存しており、Windows の
  `cmd.exe` では `*` が展開されず対象 0 件になる。PowerShell からでも Node 側スクリプトの
  呼び出し方次第で同じ問題が起き得る（未検証）。本書のビルド手順は `npm test` を経由しない
  ため Tier 0 到達には影響しない

## トラブルシュート（Windows 実機で実際に踏まれた穴）

### install が一度失敗したら package-lock.json も消す（issue #6）

失敗した `npm install` が自動生成した `apps\shell\package-lock.json` が、壊れた依存ツリー
（例: @theia/monaco-editor-core が root に hoist されず 13 箇所にネスト）を固定することが
ある。lockfile は意図的に .gitignore 済みのため `git status` に出ず、**node_modules を
全消去しても lockfile がある限り壊れた木が再現する**。症状例: theia build の esbuild が
`Could not resolve "@theia/monaco-editor-core/esm/vs/editor/common/services/editorWebWorkerMain.js"`
で失敗し続ける。

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
# そのうえで LTO 無効化 env を設定し直して npm install --no-workspaces をやり直す
```

### MSB8040（Spectre 軽減ライブラリ）で失敗する（issue #8）

`error MSB8040: Spectre 軽減のライブラリは、このプロジェクトに必要です` の顕在化は 2 箇所:

- **@vscode/windows-ca-certs**（optionalDependency）: install は exit 0 のまま**黙って**
  パッケージが外され、後段の theia build が `Could not resolve path of module:
  @vscode/windows-ca-certs [plugin @theia/esbuild-plugin]` で止まる（エラー文面から
  Spectre に辿り着きにくい代表例。win32 のみ必須解決される実装のため mac/linux では出ない）
- **node-pty**（`npm run package` 中の @electron/rebuild）: optional ではないため
  package が確定で失敗する

恒久対応は前提チェックの Spectre 軽減ライブラリ導入。検証を先へ進めるだけなら
`npx electron-builder --dir -c.npmRebuild=false` で node-pty 再ビルドを飛ばせる
（node-pty は NAPI prebuilt 同梱のため PTY は動作する — issue #9 の Tier 0 実測どおり。
恒久運用には非推奨）。

### 長パスで node_modules が消せない（issue #6 補足）

LongPathsEnabled=0（Windows 既定）の環境では、ネストした node_modules が MAX_PATH 260 を
超えると通常のツールで削除できなくなる（Python shutil.rmtree の WinError 145 等）。
`\\?\` プレフィックス付き絶対パス（例: `cmd /c rd /s /q "\\?\C:\path\to\node_modules"`）
なら削除できる。恒久対応は前提チェックの LongPathsEnabled 有効化。

### npm が install scripts を保留する構成の場合

CI ランナーの npm では allow-scripts ゲートが electron 等の install script を保留する挙動を
実測している（windows-build.yml のコメント参照）。実機の npm 11.16 では警告のみで script は
実行される観測もあり（issue #7）、挙動は環境依存。いずれの場合も electron については
手順 1b の直接配置が決定的な回避になる。他のネイティブモジュールが保留された場合は
`npm approve-scripts --no-workspaces <パッケージ名...>` で承認して `npm rebuild --no-workspaces`
を実行する（CI と同じ手当て）。

## 参考

- 設計の正本: 内部リポ（`akari-video-internal`）の windows-port 設計計画
- Windows 実機での検証記録: issue #5（パッケージ版ファイル検索）/ #6（install 前提）/
  #7（electron postinstall）/ #8（Spectre）/ #9（Tier 0 チェックリスト一周）
- 本書が検証する範囲は「ビルドが通り、アプリが起動し、基本機能が動く」Tier 0 まで。
  配布形式（NSIS 等）・コード署名・Windows 版 CI は範囲外
