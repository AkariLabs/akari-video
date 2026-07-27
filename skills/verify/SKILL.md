---
name: verify
description: "AKARI Video（現行 Theia スタック）のタスク契約が要求する検証はしご（L0 / L1 / L2）を実行するときに発動する。タスクの受け入れ条件が「verify 層: L0」「L0+L1」等を指定しているとき、各層で実際に何を・どう叩くかを確認するために読む。"
---

# verify — 検証はしご（L0 / L1 / L2）

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

タスク契約テンプレート（内部リポ `tasks/_template/task.md`）が参照する対応表の実体。
**発明した定義ではなく、直近タスクの `report.md` / `task.md` の実運用から帰納したもの**（帰納元は末尾「根拠」節）。

## 対応表

| 層 | 定義 | 判定者 | 現行スタックでの実例 |
|---|---|---|---|
| L0 | 静的・機械的検証。exit code だけで合否が決まる。実機起動・人間の目を要さない | エージェント単独 | ほぼ全タスクで必須の最下層 |
| L1 | 実機観測（自動化）。Electron を実際に起動し、CDP/Playwright で操作・スクショ・性能実測を行う。人間の主観判断を要さず、スクリプトで再現可能 | エージェント単独（スクリプト） | 2026-07-15/16 の shell 系タスクはほぼ全て L0+L1 |
| L2 | 自動化・スクリプトでは判定し切れない層（主観的な視覚品質判断・実配布物でのオーナー最終確認） | 人間（オーナー） | **現行 Theia スタックでは実例なし**（下記「L2 について」参照） |

## L0 — 静的・機械的

現行 Theia スタックでの実体は `apps/shell` の npm scripts:

```sh
cd apps/shell
PYTHON=/usr/bin/python3 npm install --no-workspaces   # 初回・依存更新時のみ
npm run build:ext                                      # tsc -b（6 拡張の型検査 + コンパイル）
npm run lint                                            # eslint "extensions/*/src/**/*.{ts,tsx}"
```

- `build:ext` と `lint` が exit 0 = L0 合格の最低ライン。CI（`.github/workflows/ci.yml`）はこの 2 つを push/PR で自動実行する
- `npm run build`（= `build:ext && theia build --mode production`）は、フロントエンド/バックエンド/electron のバンドル生成まで含むより厳密な L0 として個々のタスク契約が課すことがある（例: `shell-sb-surfaces` / `shell-sc-project` / `shell-sd-partner` / `governance-sanitize`）。ただし **CI には載せていない**（後述「地雷」参照）。タスクで `build` まで求められたら手元で `PYTHON=/usr/bin/python3 npm install --no-workspaces` 後、electron の postinstall が npm 11 の allow-scripts ゲートでスキップされて `theia build` が `ENOENT .../electron/dist/version` で落ちる点に注意し、`echo "<electron のバージョン>" > apps/shell/node_modules/electron/dist/version` で回避すること（`npm run package`/実機起動が要る L1 では、この回避では不十分 — 下記参照）
- `packages/*` 配下に触るタスクは各 package.json の build/test スクリプトが L0 の実体になる（`waveplan-2026-07-15-sbcd-e5.md` §検収ゲート）

### 既知の地雷（L0）

1. **npm 11 の allow-scripts ゲート**: `npm install` は electron / `@theia/ffmpeg` / drivelist / keytar / node-pty 等 11 パッケージの install script を既定でスキップする（`npm warn allow-scripts ...`）。`build:ext` / `lint` は素の TypeScript / eslint 実行であり、これらのネイティブモジュールを必要としないため**スキップされたままで問題なく通る**（実測済み）。実機を起動する L1 以降で初めて効いてくる
2. **Homebrew Python 3.14 と node-gyp**: macOS で `PYTHON=` を指定せず `npm install` すると、`drivelist` の `node-gyp rebuild` が Homebrew Python 3.14 の `pyexpat` ABI 不整合（`Symbol not found: _XML_SetAllocTrackerActivationThreshold`）で失敗し、install 自体が止まる。`PYTHON=/usr/bin/python3`（Apple 純正 Python）を必ず指定すること
3. **`apps/shell/package-lock.json` は意図的に `.gitignore` 済み**（`apps/shell/.gitignore` 内 `package-lock.json`）。`npm ci` は使えない。再現性は Node バージョン固定 + `--no-workspaces` で確保する（後者が無いとリポ root へ依存が hoist され、実行時間が約 2 倍・依存解決範囲が変わることを実測済み）
4. **grep マッチ 0 件は exit 1**。検証スクリプト内で grep を使うときは `|| true` を付ける

## L1 — 実機観測（Electron を CDP/Playwright で観測する）

現行スタックの L1 は「GUI スクショ必須」という形でほぼ全タスクに課されている
（`preview-streaming` / `shell-s4-tabs` / `preview-open-repair` / `project-diff-repair` /
`shell-s12-preview-tab` / `shell-sc-repair` / `shell-strip-menu-repair` 等）。
以下は `shell-s4-tabs`（report.md §6-2）と `preview-streaming`（report.md §2）で確立・実証済みの再現手順。

### 手順

1. **ビルド**（L0 に加え electron 実体が要る）:
   ```sh
   cd apps/shell
   PYTHON=/usr/bin/python3 npm install --no-workspaces
   # electron の postinstall は allow-scripts ゲートでスキップされているため、
   # 既存キャッシュから手動展開する（既にダウンロード済みの環境が前提）:
   ditto -x -k ~/Library/Caches/electron/<hash>/electron-v<version>-darwin-<arch>.zip \
     node_modules/electron/dist
   echo "<version>" > node_modules/electron/dist/version
   npm run build
   ```
2. **隔離ワークスペースを用意**: `templates/project-default/` を作業用一時ディレクトリへコピー（元ファイルは無改変）。検証対象の素材（動画等）が要るタスクは、この中に `ffmpeg` 等で実素材を生成する（例: `preview-streaming` は 4K/120 秒/836MB の MP4 を `ffmpeg -f lavfi ...` で生成し実測に使用。検証後は `rm -rf` で完全削除しコミットしない）
3. **Electron を直接起動**（`theia start` CLI や Playwright の `_electron.launch()` は不使用 — 後者は argv 解釈に既知不具合があるため）:
   ```sh
   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
     <apps/shell 絶対パス> <隔離ワークスペース絶対パス> \
     --remote-debugging-port=<port> --user-data-dir=<隔離ディレクトリ> --no-sandbox
   ```
   `THEIA_CONFIG_DIR=<隔離ディレクトリ>` を環境変数で渡し、通常の開発設定と衝突させない
4. **`playwright-core` を検証用スクラッチディレクトリにのみ `npm install`**（リポジトリ本体には追加しない）し、
   `chromium.connectOverCDP('http://127.0.0.1:<port>')` でアタッチする
5. **入れ子 webview フレームへの到達**: Theia の `WebviewWidget` は外側 `webview.localhost` オリジンの iframe → 内側 `active-frame` という二重入れ子構成を取り、素朴な `page.frames()` 探索では実コンテンツに届かないことがある。CDP の `Page.getFrameTree` と `Runtime.executionContextCreated` イベントの `auxData.frameId` を突き合わせ、実際の内側 execution context を特定してから `Runtime.evaluate` で DOM 状態（`readyState` / `currentTime` / `data-*` 属性等）を直接読む自作クライアントが必要になる場合がある（`preview-streaming` report.md §2 参照）
6. **観測・記録**:
   - スクリーンショット: CDP `Page.captureScreenshot` または Playwright の screenshot API。保存先は検証対象拡張の `evidence/<機能名>/*.png`、1 枚 500KB 以下が目安
   - 性能: `ps -o %cpu -p <pid>` を 1 秒間隔でサンプリングし GPU/renderer/main プロセスを分離して記録。タイミングは操作前後の CDP イベント/DOM 状態変化で実測（例: `readyState>=3` 到達までのミリ秒）
   - API 境界: `window.theia.container` 経由で Inversify DI コンテナから直接サービスを呼び出し、フロントエンドのガードをバイパスしてもバックエンドが独立して拒否する（多重防御）ことを確認するのも有効（`preview-streaming` report.md の配信境界検証を参照）
7. **後片付け**: 起動した Electron プロセスは `ps aux` で確認した実 PID を指定して `kill`（`pkill -f` のような広いパターンマッチは使わない）。隔離ワークスペース・巨大な生成素材は検証後に完全削除しコミットしない

### 既知の地雷（L1）

1. **拡張ディレクトリ内のネスト `node_modules`**: `apps/shell/extensions/<ext>/node_modules/` に `@theia/*` 等が残っていると、`apps/shell/node_modules/@theia/core` との二重解決で `FrontendApplicationConfigProvider` のようなモジュール単位シングルトンが分裂し、フロントエンドがプリロード画面のまま無限に止まる（dual-package hazard）。実機起動前に `find apps/shell/extensions/*/node_modules -maxdepth 0` を確認し、あれば削除してから `apps/shell/` 直下でクリーンリビルドする
2. **Electron の起動エントリ**: `package.json` の `main` フィールドどおり `lib/backend/electron-main.js` を使う。`lib/backend/main.js` を直接指定すると `BrowserWindow` が生成されず `/json/list` が空のままになる
3. **パッケージ版でのパス解決**: バンドル後の `__dirname` は開発時と異なる（`app.asar/lib/backend` 等）。`apps/shell` 外への相対パス探索を持つ機能は、`electron-builder --dir` 出力を `ELECTRON_RUN_AS_NODE=1` + `cwd=/` で実行して検証すること（`package-runtime-assets` task.md 参照）。開発時 (`npm start`) だけでの確認は不十分

## L2 について

**現行 Theia スタックへ移行した直近タスク群（2026-07-15/16、S-A〜S-D・S4/S6/S12・
preview-streaming・preview-open-repair・project-diff-repair・package-runtime-assets・
shell-sc-repair・shell-strip-menu-repair 等）で、L2 が受け入れ条件として課された実例は
一件もない。** いずれも「verify 層: L0 + L1（実機 GUI スクショ必須）」の範囲で完結しており、
自動化された実機観測（L1）が実質的な最高層として運用されている。

L2 は旧 Tauri 実装期の verify スキルで使われていた概念で、当時の実例（帰納元）:

- `2026-07-15-preview-band-artifact`: L2 = 実機での不具合再現・修正確認。加えて「オーナーが実機で帯の消失を確認」という**オーナー自身の目視**が最終ゲートに使われた
- `2026-07-15-vlog-mvp-edit`: 「L2（実機アプリ）未実施」— L1（実書き出し・ffprobe 検証）は完了したが、実機アプリでの目視（プレビュー側の合成が理屈どおりに見えるか）は L2 として区別され、範囲外とされた
- `2026-07-15-decision-cards-runtime`: 「実機（Tauri / companion 拡張 webview）での目視は本タスク範囲外（L2 非対象）」— headless Chrome での自動 DOM 検証（L1 相当）と、実アプリ webview での体感確認（L2）を明確に分けている
- 非公開の内部タスク記録の契約書（dev-harness、2026-07-14 付）は「本表 L3 実機 ≒ verify L2（実機）」と明記し、本表 L3 は「オーナーによるフィールドテスト → handoff 記録」と定義される（同じく非公開の wave 計画書、2026-07-15 付、§6）

これらに共通するのは、**L2 = 自動化・スクリプトでは判定し切れない層**という一線であり、
「実素材を使うかどうか」では区別されない（L1 でも `preview-streaming` の 836MB 4K 実撮素材のように
実素材を使うことが普通にある）。したがって現行スタックでの L2 は次のように定義する
（現行スタックでの実例が無いため外挿であることを明記する）:

> L2 = パッケージ配布物（`electron-builder` 出力）での実運用シナリオを、視覚的な質感・
> 使用感など自動化スクリプトでは判定不能な観点についてオーナー自身が確認し、handoff に記録する層。

### L2 を課すかどうかの判断基準

- 受け入れ条件が **主観的な品質判断**（「違和感がない」「忠実に見える」等、数値化できない観測項目）を含む場合
- L1 の自動観測（CDP/Playwright）では原理的に再現できない体験（実際の配布物でのインストール〜起動〜操作の一気通貫、実タッチ操作・実マウス操作の感触等）を確認する必要がある場合
- 司令塔・オーナーが明示的に実機フィールドテストを求めた場合

上記に当てはまらない限り、現行スタックのタスクは L0+L1 で完結させる（実際の運用がそうなっている）。

## どの層を課すか（タスク側の判断基準）

- **L0 のみ**: コードに実行時の観測可能な挙動変化が無いタスク（ドキュメント・CI 設定・型定義のみの変更等）。本タスク（`ci-and-verify-skill`）自身がこの例
- **L0+L1**: `apps/shell/extensions/**` や `packages/preview-engine` 等、GUI・実行時挙動に影響するコード変更を含むタスクの既定。2026-07-15/16 の shell 系タスクはほぼ全てここに属する
- **L0+L1+L2**: 上記「L2 を課すかどうかの判断基準」に該当する場合のみ。現行スタックでは前例なし

## 根拠（帰納元）

対応表・手順は非公開の内部タスク記録（`akari-video-internal`）の report.md / task.md から帰納したもの
である。内部タスク記録そのものは本リポには置かない方針（`docs/design-2026-07-13-agent-native-architecture.md`
§3 と同様の扱い）。検証手順そのもの（コマンド・観測対象・既知の地雷）は上記「L0」「L1」節に実行可能な形で
記載済みであり、以下は帰納元タスクの識別のみを示す（すべて非公開）:

- preview-streaming（2026-07-16）: L1 再現手順・836MB 実素材・入れ子 webview フレーム到達法
- shell-s4-tabs（2026-07-16）: L1 再現手順・dual-package hazard・Electron 起動エントリの地雷（§6-2 に手順まとめ）
- package-runtime-assets（2026-07-16）: パッケージ版 L1 の実施方法
- 内部タスク記録の README: 検収フロー 4-c の CI 前提
- 内部タスク記録のタスクテンプレート: verify 層の対応表という語彙そのものの出典
- dev-harness 契約書（2026-07-14）・wave 計画書（2026-07-15）§6: 検証レイヤ表・L0/L1/L2/L3 の定義
- preview-band-artifact・vlog-mvp-edit・decision-cards-runtime（いずれも 2026-07-15、旧 Tauri 期）:
  L2 実例。現行スタックに L2 実例が無いため、L2 の定義根拠としてはこれらのみ
