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
PYTHON=/usr/bin/python3 npm ci --no-workspaces   # 初回・依存更新時のみ
npm run build:ext                                 # tsc -b（9 拡張の型検査 + コンパイル）
npm run lint                                       # eslint "extensions/*/src/**/*.{ts,tsx}"
```

- **`npm install` ではなく `npm ci`**。`apps/shell/package-lock.json` は 2026-08-19 から**追跡されている**（旧方針は `.gitignore`）。`npm install` は lock をその日のレジストリで書き換える＝ドリフトの入り口なので、検証では使わない。依存を意図的に上げたときだけ `npm install` して lock の差分をコミットする
- **`--no-workspaces`** は apps/shell を単体プロジェクトとして扱わせる指定（`apps/shell/package-lock.json` + `apps/shell/node_modules` を使う）。付けないとリポ root の workspace 側（root の `package-lock.json`）へ寄り、`packages/*` まで巻き込んで実行時間が約 2 倍になる
- install の postinstall で **`npm run preflight`** が走る（`scripts/ensure-no-nested-extension-deps.mjs` → `scripts/ensure-electron-dist.mjs`）。`npm run build` の prebuild と `npm start` の prestart も同じ preflight を通る。おかげで **electron の展開も入れ子 `node_modules` の掃除も手作業では要らない**（どちらも下の「地雷」の自動修復）
- `build:ext` と `lint` が exit 0 = L0 合格の最低ライン。CI（`.github/workflows/ci.yml`）の L0 ジョブはこの 2 つに続けて apps/shell 本体 + 拡張のユニットテスト（`npm run test:shell`）を push/PR で自動実行する（2026-09-02〜。install は lock 追跡に合わせて `npm ci --no-workspaces --ignore-scripts`）
- **`packages/*`・`scripts/test`・`skills/*` のユニットテストも CI に載っている**（2026-09-02〜）。レーン定義の正本は `scripts/ci/run-unit-tests.mjs`: `npm run test:unit`（pure = 外部ツール不要・required）/ `npm run test:quarantine`（main で既に赤・参考）/ `npm run test:media`（ffmpeg / Chrome が要る・参考）/ `npm run test:lanes`（一覧と、CI に載せていないものの理由）。ローカルでは触ったパッケージの `npm test` で足りる。CI と同じ集合を手元で回したいときだけ `npm run test:unit`
- `npm run build`（= `build:ext && theia build --mode production`）は、フロントエンド/バックエンド/electron のバンドル生成まで含むより厳密な L0 として個々のタスク契約が課すことがある（例: `shell-sb-surfaces` / `shell-sc-project` / `shell-sd-partner` / `governance-sanitize`）。ただし **CI には載せていない**（後述「地雷」参照）。バンドラは webpack ではなく **esbuild**（Theia 1.73 の既定。`apps/shell/webpack.config.js` が無いので `theia build` は必ず esbuild 経路を通る）
- `packages/*` 配下に触るタスクは各 package.json の build/test スクリプトが L0 の実体になる（`waveplan-2026-07-15-sbcd-e5.md` §検収ゲート）

### 既知の地雷（L0）

1. **npm 11 の allow-scripts ゲートは `apps/shell/package.json` の `allowScripts` で開けてある**（許可リストであって拒否リストではない）。2026-08-19 実測: `npm ci --no-workspaces` 後のツリーで install 系スクリプト（preinstall / install / postinstall + `binding.gyp` による暗黙の `node-gyp rebuild`）を持つ依存は **11 個ちょうどで、その全部が `allowScripts` に列挙済み＝実行される**（`npm rebuild electron --foreground-scripts` で electron の postinstall が実際に走ることを確認）。**旧記述「11 パッケージの install script を既定でスキップする」は誤り**。ただし列挙は `名前@完全一致バージョン` なので、**版が 1 つずれるとその行はマッチせず、その依存の install script が黙って走らなくなる** — lock 追跡でこのずれは止まる。依存を上げるときは `allowScripts` も一緒に直すこと。`build:ext` / `lint` はネイティブモジュールを要さないので、走っても走らなくても通る。CI の L0 レーンは `--ignore-scripts` で全部止めている
2. **Homebrew Python 3.14 と node-gyp**: macOS で `PYTHON=` を指定せず install すると、`drivelist` の `node-gyp rebuild` が Homebrew Python 3.14 の `pyexpat` ABI 不整合（`Symbol not found: _XML_SetAllocTrackerActivationThreshold`）で失敗し、install 自体が止まる。`PYTHON=/usr/bin/python3`（Apple 純正 Python）を必ず指定すること
3. **electron の postinstall は Node 26 で黙って途中終了する**（2026-08-19 実測）。`node_modules/electron/install.js` は zip 展開に extract-zip 2.0.1 → yauzl 2.10 → fd-slicer 1.1 を使うが、**Node v26.3.0 ではこの pipe 経路が 1,900,544 B（64KiB × 29 チャンク）で停止し、`end` も `error` も出ないままイベントループが空になって exit 0 で終わる**。結果 `dist/` には `LICENSE` と切り詰められた `LICENSES.chromium.html` だけが残り、`Electron.app` も `dist/version` も `path.txt` も無い状態が「install 成功」として通る（Node 22.23.1 では同じ zip が完走。zlib 単体も fd-slicer 単体も Node 26 で正常なので、バックプレッシャー解除後に読み出しが再開されないのが実体）。**`scripts/ensure-electron-dist.mjs`（preflight）が結果だけを見て検出し、`ditto` / `tar` / `unzip` で展開し直して `path.txt` まで書く**ので、以前ここに書いていた「`ditto -x -k` で手展開し `echo <version> > dist/version` する」手順はもう不要
4. **`apps/shell/package-lock.json` は追跡対象**（2026-08-19 に方針転換、`apps/shell/.gitignore` から除外）。旧記述「`npm ci` は使えない／再現性は Node 固定 + `--no-workspaces` だけで担保する」は**無効**。実測: 追跡前は 1 か月で 1400 パッケージ中 63 パッケージが動いていた（`@babel/*` / acorn / postcss / react / terser / webpack 5.108.4→5.109.2 等）
5. **grep マッチ 0 件は exit 1**。検証スクリプト内で grep を使うときは `|| true` を付ける

## L1 — 実機観測（Electron を CDP/Playwright で観測する）

現行スタックの L1 は「GUI スクショ必須」という形でほぼ全タスクに課されている
（`preview-streaming` / `shell-s4-tabs` / `preview-open-repair` / `project-diff-repair` /
`shell-s12-preview-tab` / `shell-sc-repair` / `shell-strip-menu-repair` 等）。
以下は `shell-s4-tabs`（report.md §6-2）と `preview-streaming`（report.md §2）で確立・実証済みの再現手順。

### 手順

1. **ビルド**（L0 に加え electron 実体が要る）:
   ```sh
   cd apps/shell
   PYTHON=/usr/bin/python3 npm ci --no-workspaces
   npm run build
   ```
   electron の実体（`node_modules/electron/dist` + `path.txt`）は postinstall / prebuild の
   `npm run preflight` が用意する（キャッシュに zip が無ければ `@electron/get` で取りに行く）。
   **手で `ditto` する手順・`echo <version> > dist/version` する回避策はもう要らない**
   — 要る状況になったら preflight が exit 1 で止まって理由を出す（L0 §地雷 3）
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

1. **拡張ディレクトリ内のネスト `node_modules`（この層で最も踏まれている地雷）**: `apps/shell/extensions/<ext>/node_modules/` に `@theia/core` の 2 つ目の実体が入ると、esbuild は realpath 単位でモジュールを束ねるため 1 つの `bundle.js` に `frontend-application-config-provider` が 2 本入る。`src-gen/frontend/index.js` は片方に `set()` し、拡張側はもう片方から `get()` するので、フロントエンドが
   ```
   Failed to start the frontend application.
   Error: The configuration is not set. Did you call FrontendApplicationConfigProvider#set?
   ```
   でプリロードのスピナーのまま止まる（dual-package hazard）。**2026-08-19 に実機で再現・確定**: 同一ツリーで `extensions/akari-preview/node_modules/@theia/core` を作った状態だけがこのエラーを出し、消せば起動する。原因は拡張ディレクトリ単体での `npm install`（1 回打つと 643 パッケージが入る）。
   **拡張ディレクトリで `npm install` を打たないこと**。打ってしまっても preflight（postinstall / prebuild / prestart）が入れ子を削除して直すが、`bundle.js` は作り直しが要るので `npm run build` からやり直す。
   なお **この症状を「webpack の版のせい」と読み違えた前例がある**（2026-08-18 timeline-z-order-unification §申し送り 2）。`theia build` は esbuild 経路であって webpack を一切呼ばない — webpack 5.109.2 が入ったままでも起動することを実測済みなので、この症状を見たらまず入れ子 `node_modules` を疑う
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
