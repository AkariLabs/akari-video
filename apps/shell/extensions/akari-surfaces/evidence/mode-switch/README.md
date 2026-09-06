# 進め方切り替えの検証証跡

以下はラッパーが実施した手順と実測値の記録。

## L0（決定論）

### 手順 + 実測

- `npm --prefix apps/shell run build:ext`（tsc -b 拡張 9 本）緑
- `npm --prefix apps/shell/extensions/akari-surfaces run build`（tsc -b）緑
- `npm --prefix apps/shell/extensions/akari-surfaces test` = tests 107 / pass 107 / fail 0（変更前 102 → applyAutonomy のテスト 5 本を追加）
- `node --test packages/schemas/test/validate-intake.test.mjs` = 11 / 11（変更前 10）
- `node --test packages/akari-launcher/test/cli.test.mjs` = 10 / 10（変更前と同一。x-akari-labels を読む task-labels に影響なし）
- `npm run test:shell`: 変更前 tests 2581 / pass 2580 / fail 1、変更後 tests 2586 / pass 2585 / fail 1。
  失敗集合は同一の 1 本（akari-preview の `shell fragment assets use shared resolution and registered stream URLs`。
  macOS の /var → /private/var シンボリックリンクに由来する既存赤で本変更とは無関係）

## L1（実機 Electron tier 2 + CDP）

### 手順

- 敷設: apps/shell/node_modules/electron/dist（electron 39.8.7）+ path.txt。native アドオン 7 種の build/ も敷設
- 起動: `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス> <隔離 ws 絶対パス> --remote-debugging-port=9333 --user-data-dir=<隔離> --no-sandbox`（THEIA_CONFIG_DIR も隔離）
- 隔離 ws = templates/project-default/ のコピー + 検証用に置いた .akari/intake.json
  （version 1 / title / tasks 2 件 / target.duration_s 30・keep_length false・taste あり / autonomy: collaborative / status: submitted / submitted_at）
- **Electron ではコンテキストメニューがネイティブ実装**のため CDP の DOM 側からは見えない（.lm-Menu / .monaco-menu ともに 0 件）。
  そこでメニュー項目の実行と同一経路である CommandService.executeCommand で 3 コマンドを実行して実測した

### 実測

- 右端縦バー最下段の実測: `shell.rightPanelHandler.bottomMenu.items` = [{ id: 'akari-mode-switch', title: '進め方: 一緒に作る', iconClass: 'codicon codicon-settings', order: 0 }]。
  DOM 実測 rect = x 1072 / y 596 / w 48 / h 46（ウィンドウ幅 1120 の右端・最下段）
- メニュー `['akari-mode-switch-menu']` の children 3 件（順に akari.mode.set.full-auto / .checkpoint / .collaborative）。
  label はそれぞれ「そのまま — 言った通りに入れて、見ずに書き出す」「提案つき — 良さそうな物も入れて見せる。要らなければ消す。判子は書き出しの 1 回」「一緒に作る — 方針・素材・実行の要所で確認する」
- 「提案つき」実行 → intake.json の diff は autonomy 行 1 本のみ（`- "autonomy": "collaborative"` / `+ "autonomy": "checkpoint"`）。他 6 フィールド（version / title / tasks / target / status / submitted_at）は不変。縦バーの title が「進め方: 提案つき」へ更新
- 「そのまま」実行 → diff は autonomy 行 1 本のみ（checkpoint → full-auto）。title が「進め方: そのまま」へ更新。validate-intake OK
- intake.json が無いとき: コマンド実行で通知「進め方フォームで先に進め方を決めてください」が出て、intake.json は生成されない。title は「進め方を切り替える」へフォールバックし、ファイルを戻すと「進め方: そのまま」へ復帰

### diff

「提案つき」実行:

```diff
- "autonomy": "collaborative"
+ "autonomy": "checkpoint"
```

「そのまま」実行:

```diff
- "autonomy": "checkpoint"
+ "autonomy": "full-auto"
```

いずれも他 6 フィールド（version / title / tasks / target / status / submitted_at）は不変。

### スクリーンショット

- [01-right-bar-bottom-switch.png](./01-right-bar-bottom-switch.png) = 右端縦バー最下段のツマミアイコンとホバー tooltip「進め方: そのまま」
- [02-intake-form-autonomy-labels.png](./02-intake-form-autonomy-labels.png) = 進め方フォームの 3 択（そのまま / 提案つき / 一緒に作る + 説明文）。
  縦バーから書いた full-auto がファイル監視でフォームに反映され「そのまま」が選択済みになっている

### 実機で見つかった通知待機の修正

intake.json が無い状態でのコマンド実行では、通知を閉じるまで executeCommand の Promise が返らず、300 秒待っても未解決だった。その間 writing が true のままとなり、3 コマンドすべての CommandRegistry.isEnabled が false に固定された。

この実測後、info / error 通知の await を void に変更し、通知を閉じるのを待たずに finally で writing を戻すよう修正した。通知文言・intake.json を生成しない挙動・書き込み経路・title 更新は変更していない。

- 修正後に再ビルド・再起動して全項目を取り直した。L0 は build:ext 緑 / akari-surfaces build 緑 /
  akari-surfaces test 107 pass / validate-intake 11 pass / launcher cli 10 pass /
  test:shell = tests 2586 / pass 2585 / fail 1（既存赤 1 本のみで変更前と同一）
- L1 再測: bottomMenu.items・メニュー children 3 件・DOM rect（x 1072 / y 596 / w 48 / h 46）は修正前と同一。
  3 コマンドの isEnabled は起動直後から [true, true, true]
- 「提案つき」→「そのまま」の 2 回の書き込みで diff は毎回 autonomy 行 1 本のみ。
  autonomy を除いた全フィールドの JSON 同値比較も true（他フィールド 1 バイトも変わらない）。validate-intake OK
- intake.json が無い状態でのコマンド実行は**即座に resolve**し、通知が出て、intake.json は生成されず、
  isEnabled は [true, true, true] のまま（修正前の恒久無効化が解消したことを実測）。
  title は「進め方を切り替える」へフォールバックし、ファイルを戻すと「進め方: そのまま」へ復帰
- 掲載の png 2 枚は修正後のビルドで取り直したもの
