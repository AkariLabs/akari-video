---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-09-03
---

# library-full-panel L1 検証手法・証跡

オーナー指示（2026-09-03）:

> Akari Video の shell の左にあるライブラリのタブですが、これは左のパネル全体に表示した方が
> いいかも。今は「できたもの」と一緒になっているが、これは関係ないと思うので。ライブラリ特化
> タブにした方がいい。あと一番上に書いてある「素材」と言う文字があるけどこれいらないと思う。

変更 2 点:

1. **ライブラリ面はパネル全体**（`akari-role-buckets-widget.tsx#render`）— `topView === 'catalog'`
   のとき下段「できたもの」を出さず、上段 1 面で高さを使い切る。プロジェクト面（`materials`）は
   従来どおり 1.2 : 1 の上下 2 分割のまま。「できたもの」自体は撤去していない（面の出し分け）
2. **最上部のタイトル帯を畳む**（`akari-activity-bar-curation.ts`）— 素材/ライブラリのビューが
   current のときだけ Theia のサイドパネル・タイトル帯（`.theia-sidepanel-toolbar`、`title.label`
   =「素材」を大文字で描く 35px の帯）を Lumino の `hide()` で畳む。検索・パートナー/拡張は
   ツールバー項目を持つので対象外（current が変わるたびに出し直す）

CSS の `display: none` を使わない理由: この帯は `SidePanelHandler.createContainer()` が組む
BoxLayout の子で、Lumino は子を絶対配置（top/height を実測して書く）する。display だけ消しても
下の dockPanel の top オフセットは帯の高さぶん残り、空白の帯になるだけで詰まらない。実測でも
`hide()` 経路で `paneTop: 0`（パネル内容が最上部から始まる）を確認した。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。`cdp-lib.mjs` は `left-panel-split`
（2026-08-03）の共有ヘルパーをそのまま複製（様式踏襲・中身無改変）。依存追加なし。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペース（リポ外の一時作業場）へコピーし、
   `.akari/intake.json`（`status: "submitted"`）で他画面の gate を解放
3. フィクスチャを追加（元テンプレートは無改変）:
   - `exports/final-v1.mp4` / `final-v2.mp4`: ffmpeg 生成の実 1 秒 mp4。`touch -t` で mtime を
     ずらす（v1 = 2026-08-02 22:41 / v2 = 23:10）
   - `.akari/reports/edit-lint-report.html`（`<title>` あり）/ `render-report.html`（`<title>` なし）
   - `assets/interview.mp4`: プロジェクト面（上段）の回帰確認用に 1 本
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=32951 --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
5. `run-l1.mjs` で CDP アタッチ → DOM 実測 + スクショ 5 枚

### 検収 worktree のセットアップで踏んだもの（透明性のため記録）

- `npm install`（scripts あり）は `drivelist@12.0.2` の node-gyp ビルドが Node v26.3.0 で落ちる。
  `harness/scripts/repair-shell-native-deps.sh` の標準手順どおり `--ignore-scripts` で入れ直した
- 同スクリプトの electron dist 復元 / addon 補充は `apps/shell/node_modules/` を見るが、この
  worktree では npm workspaces のホイスティングでどちらもリポ**ルート**の `node_modules/` に居た。
  ルート側を対象に同じ処理（cache zip から `ditto` で dist 復元 + `*.node` を本体リポからコピー +
  `codesign --force --deep --sign -`）を手で実行した

## 実測結果（`run-log.json` / スクリーンショット）

| # | 局面 | layout | できたもの | タイトル帯 | 判定 |
|---|---|---|---|---|---|
| 00 | 起動直後（プロジェクト面） | `split` | あり（4 件） | `lm-mod-hidden` / 高さ 0 | ✅ |
| 01 | ライブラリ面へ切替 | `library-only` | **なし** | 高さ 0 | ✅ |
| 02 | プロジェクト面へ戻す | `split` | あり（4 件） | 高さ 0 | ✅ |
| 03 | 検索ビューへ切替 | — | — | **高さ 35 / "SEARCH"** | ✅ 回帰なし |
| 04 | 素材ビューへ戻す | `split` | あり（4 件） | 高さ 0 | ✅ |

- パネル内容の `paneTop` は全局面で `0` — 帯を畳んだぶんが実際に詰まっている
- ライブラリ面・プロジェクト面とも `paneHeight: 646`（パネル全高）
- `window.__errCount` = 0（全フェーズ通して JS エラーなし）

## 機械検収

| 項目 | 結果 |
|---|---|
| `npm run build:ext`（tsc -b 9 拡張） | exit 0 |
| `npm run lint`（eslint） | exit 0 |
| `npm run build`（theia build --mode production） | exit 0 |
| `node scripts/ci/run-unit-tests.mjs --lane shell` | 2072 tests / 2072 pass / 0 fail |
