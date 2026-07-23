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
- [ ] **Visual Studio Build Tools + Python は基本的に不要**（下記「ネイティブモジュールの
      扱い」参照）。ただし `npm install` や `npm run package` が
      `node-gyp rebuild` に落ちて失敗した場合の**フォールバックとして**用意しておくと安全:
      - Visual Studio Installer →「C++ によるデスクトップ開発」ワークロード
      - Python 3.x（[python.org](https://www.python.org/) または
        `winget install Python.Python.3.12`）

### ネイティブモジュールの扱い（実地調査済み・2026-07-23）

このリポジトリのネイティブ依存（`node-pty` / `drivelist` / `keytar` /
`msgpackr-extract` / `@parcel/watcher`）は全て **prebuild-install 系または
npm optionalDependencies 系**の仕組みで配布されている。実地確認した結果:

| パッケージ | 用途 | win32-x64 の入手経路 |
|---|---|---|
| `node-pty` | ターミナル（PTY） | npm パッケージ本体に `prebuilds/win32-x64/{conpty,conpty_console_list}.node` を**同梱**（ダウンロード不要） |
| `drivelist` | ドライブ一覧 | `install` スクリプトが `prebuild-install --runtime napi` を先に試行 |
| `keytar` | 資格情報保存 | 同上（`prebuild-install \|\| npm run build`） |
| `msgpackr-extract` | msgpack 高速化 | `node-gyp-build-optional-packages`（npm optionalDependencies 経由の prebuilt バイナリ） |
| `@parcel/watcher` | ファイル監視（Theia が使用） | `optionalDependencies` に `@parcel/watcher-win32-x64` / `-win32-arm64` を明記。npm が自動選択 |

いずれも win32-x64 向けの配布物が存在するため、**通常は Windows 実機での `npm install` /
`npm run package` はコンパイラ無しで完了する見込み**。VS Build Tools + Python が要るのは
「該当バイナリが見つからず node-gyp のソースビルドにフォールバックした場合」のみ
（このリポの mac 実機では実測できない分岐 — 実機での唯一の未検証ポイント）。

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
npm install --no-workspaces

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
上表のとおり `.node` ファイルのみで足りるため）→ `electron-builder --dir --win`
（自動で `@electron/rebuild` → ファイルコピー → asar 生成）→
`postpackage`（`verify-asar-contents.mjs` — 拡張 9 本・skills・schemas・
project-default テンプレート・node-pty の win32 ネイティブモジュールが
`electron-builder-out/win-unpacked/resources/app.asar` に同梱されているかを検証。
「配布はブロックしないがサイズ目安 1536MB 超で警告」も参照）。

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
      直下の「ffmpeg 導入」を先に実施してからアプリを再起動）
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
  第 2 陣で設計済み・未着手（`planning/waveplan-2026-07-23-windows-port.md` 参照、内部リポ）
- **フォント見た目差**: テロップは現状 OS フォントフォールバック（Yu Gothic 等）に依存し、
  Mac の見た目と差が出る。「壊れないが見た目が変わる」状態。Noto Sans JP 同梱は第 2 陣で
  設計済み・未着手
- **codex/claude CLI 連携（akari-partner 拡張）**: Claude Code のネイティブ bootstrap は
  現状 macOS/Linux 専用実装で win32 では例外を投げる。Codex バイナリの自動取得も win32
  未対応。並行タスク `win-agent-lane` で対応中（本書の範囲外・`apps/shell/extensions/**`
  は本タスクの編集禁止領域）
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

## 参考

- 設計の正本（内部リポ）: `planning/waveplan-2026-07-23-windows-port.md`
- 本書が検証する範囲は「ビルドが通り、アプリが起動し、基本機能が動く」Tier 0 まで。
  配布形式（NSIS 等）・コード署名・Windows 版 CI は範囲外
