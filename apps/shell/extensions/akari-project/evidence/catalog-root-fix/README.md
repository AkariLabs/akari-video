---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-25
---

# catalog-root-fix L1 検証手法・証跡

タスク: `2026-07-25-catalog-root-fix`（カタログ場所の解決強化 — 自動検出の上方探索拡充 +
空状態フォルダピッカー）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は `catalog-tab`
（この worktree・同日）と同じ共有ヘルパー（様式踏襲・中身無改変）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペース（リポ外）へ 2 本コピー
   （`ws-scenario1` / `ws-scenario2`）。それぞれ `.akari/intake.json`（`status: "submitted"`）
   でホーム v2 の home-flow ゲートを解放。`ws-scenario2` には ffmpeg で生成した実 2 秒動画
   `assets/regression-clip.mp4`（素材タブ回帰用）と、ルート直下に実 1x1 PNG
   `unorganized-shot.png`（未整理セクション回帰用）を追加
3. **`THEIA_CONFIG_DIR` 環境変数による User スコープ設定の完全隔離**（今回新たに確立した手法 —
   `catalog-tab` 検証の申し送り事項「Theia の User スコープ設定が `--user-data-dir` で隔離されない
   挙動…恒久的な隔離手段の確立はしていない」に対する回答）。
   `@theia/core` の `EnvVariablesServerImpl.createConfigDirUri()`
   （`node_modules/@theia/core/lib/node/env-variables/env-variables-server.js`）は
   `process.env.THEIA_CONFIG_DIR` が設定されていればそれを最優先し、`apps/shell/data/user-data`
   の存在チェックや `homedir()/.theia` へのフォールバックを一切行わない実装であることをソース確認した。
   起動のたびに専用ディレクトリを指定することで、`preferences.set(..., PreferenceScope.User)` の
   実書き込み先を完全に隔離できる（モンキーパッチ不要）。検証前後で `~/.theia/settings.json` の
   sha256 を比較し、一切変更されていないことを実測で確認済み（本 README 末尾）
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動。`THEIA_CONFIG_DIR=<隔離dir>` を環境変数として渡す。
   scenario1（上方探索の実測）だけは起動時の shell cwd を `/private/tmp`
   （カタログと無関係な場所）に設定した
5. **ネイティブ OS フォルダ選択ダイアログの扱い**: `FileDialogService`（Electron ターゲットでは
   `ElectronFileDialogService` — ネイティブ `dialog.showOpenDialog` を IPC 経由で呼ぶ）は
   CDP から直接操作できない（`create-project-asar` 検証記録に明記された既知の制約と同じ）。
   本タスクでは Theia 自身が起動時に公開する `(window.theia=window.theia||{}).container=e`
   （`lib/frontend/bundle.js` — akari-project 側が追加したデバッグフックではない、Theia 本体の
   起動コード）を使い、inversify の `_bindingDictionary` を実行時に走査して
   `Symbol(FileDialogService)` / `Symbol(PreferenceService)` の実バインディングキーを特定、
   それぞれのシングルトンインスタンスを直接 `container.get()` で取得した。
   `FileDialogService` のインスタンスは `showOpenDialog` メソッドだけを一時的に固定 URI を返す
   スタブへ差し替え（対象 URI は `getRootNode()` — protected だが TS の protected は実行時には
   強制されないため呼び出し可 — が返す既存 URI インスタンスの `withPath()` で組み立てた実物の
   URI）、`PreferenceService` は差し替えず本番の `.set(key, value, PreferenceScope.User)` を
   そのまま呼んだ。widget（`AkariRoleBucketsWidget`）はどちらも通常の DI 注入でこの同一
   シングルトンを参照しているため、`pickCatalogFolder()` 自体は完全に本番コードのまま実行される
   ——差し替えたのは「OS がどのフォルダを返すか」という一点のみ。akari-project 側のソースコードは
   一切変更していない（境界順守。デバッグフックの追加・削除サイクルも不要だった）
6. 検証は 3 本の独立プロセスに分割（`catalog-tab` と同じ「単一長時間セッションでの
   renderer 詰まりを避ける」方針）:
   - `scenario1-upward-search.mjs`: cwd を `/private/tmp` にした起動での上方探索フォールバック
   - `scenario2-picker.mjs`: 同一プロセス内で「不正フォルダ選択 → 拒否」「実カタログ選択 →
     成功 + preference 書き込み」「カタログ検索/カテゴリ動詞・素材タブ・未整理セクションの回帰」
   - `scenario3-restart.mjs`: scenario2 と**同一**の `THEIA_CONFIG_DIR` / `--user-data-dir` で
     プロセスを再起動し、ピッカーを一切操作せずカードが並ぶことを確認（永続の実証）
7. 送信・受信は実 UI 操作のみで検証: 「フォルダを選ぶ」ボタンの実クリック、検索ボックスへの
   実テキスト入力、カテゴリチップの実クリック
8. 後片付け: 各プロセスは実 PID を指定して `kill -9`。Electron Helper（`lib/backend/main.js` /
   `plugin-host` / `ipc-bootstrap`）が主プロセス kill だけでは孤児化することを毎回
   `ps aux | grep "catalog-root-fix/apps/shell"` で確認し、残存があれば個別に `kill -9`。
   全実行終了後、ワークスペースパスに依存しない `plugin-host` 単独 grep（machine-wide）でも
   残存ゼロを確認した（`catalog-tab` の教訓を踏襲）

## 実測結果（詳細は各 `scenarioN-log.json` / スクリーンショット）

| # | 項目 | 結果 |
|---|---|---|
| L1-1 | 現行 4 候補の外になる起動配置（cwd=`/private/tmp`、カタログと無関係）→ 上方探索で解決されカードが並ぶ | `scenario1/01-upward-search-result.png`。実測 `itemCount=24, missingCount=36`（実カタログの実数値。`catalog-tab` 検証と一致）。事前に静的計算で、既存 4 候補（`__dirname`/`process.cwd()` 起点の固定オフセット）が cwd=`/private/tmp` かつ compiled `__dirname=apps/shell/lib/backend` の条件下ではいずれも解決できないことを確認済み（本 README 末尾「既存4候補が届かないことの事前確認」）— 消去法で、この実測はテスト対象の上方探索フォールバックが機能した証拠になる |
| L1-2 | 不正フォルダ選択 → 日本語の理由表示・一覧は変わらない | `scenario2/02-invalid-folder-error.png`。カテゴリディレクトリも INDEX.md も持たないフォルダを選択 → 実測エラー文言 `選んだフォルダーにカタログの内容が見つかりません（3d・telop・audio・broll・font・luts のいずれかのフォルダー、または INDEX.md が必要です）。` を `[data-akari-catalog-pick-error]` から取得。空状態のまま・`akari.catalog.root` preference も書き換わっていないことを実測（`preference-unchanged-after-invalid`） |
| L1-1(picker経路)/L1-4 | 「フォルダを選ぶ」→ 実カタログ選択 → preference 書き込み → 一覧が即再読込 | `scenario2/03-valid-folder-cards.png`。実測 `itemCount=24, missingCount=36`（実カタログと一致）。preference 書き込み確認: `pref.get('akari.catalog.root')` が選択パスと一致。空状態文言が消えたことも確認 |
| L1-3 | preference 書き込み後にアプリ**完全終了 → 再起動**（同一 `THEIA_CONFIG_DIR`/`--user-data-dir`）→ ピッカー不要でカードが並ぶ（永続の実証） | `scenario3/01-restart-cards.png`。ピッカーに一切触れず `itemCount=24, missingCount=36` を実測。「フォルダを選ぶ」ボタンが存在しないことも確認（= 空状態に戻っていない）。隔離設定ディレクトリの `settings.json` を直接 `cat` し、`akari.catalog.root` が選択した実カタログパスのまま保存されていることも確認 |
| L1-6 回帰 | カタログの検索/カテゴリ動詞 | `scenario2/04-search-regression.png`。検索語 `ヴィンテージ` → `3d/vintage-camera` を含む結果。カテゴリチップ `3d` → 3 件（実カタログの 3d 内訳）に絞込み・`All` で復帰 |
| L1-6 回帰 | 素材タブ（ドロップゾーン/カード）・未整理セクション | `scenario2/05-materials-and-unorganized-regression.png`。ドロップゾーン健在・`regression-clip.mp4` カード表示・未整理セクションに `unorganized-shot.png`（`data-akari-unorganized-count="1"`）を実測 |
| 隔離・後片付け | 実 Electron 隔離起動 + 終了時 kill + 孤児プロセス確認 | 各回 `ps aux` で `catalog-root-fix/apps/shell` を含むプロセス残存ゼロを確認。`plugin-host` の machine-wide grep でも本タスク由来の残存ゼロ |
| `~/.theia/settings.json` 非汚染 | 検証前後で sha256 一致 | `58f5109d…` で不変（本 README 末尾に前後の値を記録） |

## L0（単体テスト・静的検査）

- `npm run build:ext`: exit 0
- `npm run lint`: exit 0
- `apps/shell/extensions/akari-project` の `npm test`: **52/52 pass**
  （既存 46 件 + 新規 6 件: `resolveUpwardCatalogRoot`〔一致あり×2（祖先/起点自身）・一致なし・
  深すぎ・境界確認（maxDepth+1 で見つかる）・ファイルシステムルート到達時の打ち切り〕）

## 既存4候補が届かないことの事前確認（消去法の根拠）

`findBundledCatalog()` の既存 4 候補は `__dirname`（開発時ビルドでは
`apps/shell/lib/backend`）または `process.cwd()` からの固定オフセット。scenario1 は
cwd を `/private/tmp` にして起動したため、`resolve(process.cwd(), '../../catalog')` /
`resolve(process.cwd(), 'catalog')` の 2 候補は構造的に到達不能。残る 2 候補
（`__dirname` 相対の固定オフセット）は cwd に依存しないため、起動前に Node で直接
`fs.existsSync` を実行して事前確認した:

```
resolve(apps/shell/lib/backend, '../catalog')              → false
resolve(apps/shell/lib/backend, '../../../../../../../catalog') → false（_edit/catalog は存在しない）
```

したがって scenario1 でカードが並んだことは、消去法により新設の上方探索フォールバック
（`resolveUpwardCatalogRoot()`、深さ 4 で `catalog-root-fix/catalog` に到達）が機能した
ことの実測的証明になる。

## `THEIA_CONFIG_DIR` 分離の実測確認（透明性のため記録）

検証前:
```
58f5109da22fb40af6aa8bf1aeda2e61e26c0c0c7790106e6b51d6b89987f82d  <HOME>/.theia/settings.json
```

scenario2/scenario3 で `akari.catalog.root` を 3 回書き換えた（不正パス →
実カタログパス → 再起動での読み取りのみ）後:
```
58f5109da22fb40af6aa8bf1aeda2e61e26c0c0c7790106e6b51d6b89987f82d  <HOME>/.theia/settings.json
```
sha256 完全一致——不変を確認。実際の書き込み先は
`<THEIA_CONFIG_DIR>/settings.json`（scenario2 の隔離ディレクトリ）のみで、最終的な内容は:
```json
{
    "akari.catalog.root": "<WORKTREE>/catalog"
}
```

## 設計裁定の実装確認

- カタログルート解決順: preference `akari.catalog.root`（設定されていればそれのみを検証・
  見つからなければ空状態） → 未設定時はリポ開発配置の固定 4 候補 → 見つからなければ
  `__dirname`/`process.cwd()` 起点の上方探索（最大 8 階層・`catalog/INDEX.md` の存在で判定・
  最初の一致を採用）→ どちらも無ければ空状態文言
- 空状態の「フォルダを選ぶ」→ ネイティブフォルダ選択 → 妥当性検証（直下にカテゴリディレクトリ
  〔3d/telop/audio/broll/font/luts〕または `INDEX.md` があること）→ 合格なら
  `preferences.set('akari.catalog.root', fsPath, PreferenceScope.User)` → `loadCatalog()` を
  明示的に再実行（`onPreferenceChanged` 配線に加えて体感を待たせない即時反映）
- カタログ表示/カード/動詞・meta.json スキーマ・preference 名・他 extensions は無変更
  （境界順守。差分は `apps/shell/extensions/akari-project/**` のみ）

## 未確認事項

- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみで検証）
- パッケージ版（electron-builder でビルドした .app）での再検証はしていない（開発ビルドでの
  検証。`findBundledCatalog()` のパッケージ版固定候補〔`__dirname` から 7 階層上〕・上方探索
  ともにロジックは cwd/`__dirname` 非依存の探索アルゴリズムなので開発/パッケージ間で分岐しないが、
  実機での最終確認は今後の課題として申し送る）
- オーナー実機の実際の起動配置（固定 4 候補を外していた具体的な原因）そのものの特定はしていない
  （task.md の指示どおり、原因を仮定せず「探索を頑健にする」汎用的な修正で対応した）
