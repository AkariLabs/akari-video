---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-25
---

# quick-export L1 検証手法・証跡

タスク: `2026-07-25-quick-export`（GUI 直行のクイック書き出し — 設定 quick-pick
4 連鎖の末尾「実行方法」で「この場で書き出す（推奨）」を選ぶと、
akari-shell-strip 自身のバックエンドが `packages/edit-lint` /
`packages/render-cut` の既存 CLI を子プロセスで直接実行する。
「エージェントに任せる」は既存の依頼パケット注入を無改造で流用）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は
`export-button`（2026-07-25-export-button）と同じ共有ヘルパー（様式踏襲・
中身無改変）。`launch.mjs` / `scenario-helpers.mjs` は本タスク用に新設した
共通ヘルパー（Electron 起動・kill・quick-pick 操作）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペース（リポ外）へ
   複数コピーし、`.akari/intake.json`（akari-surfaces の実物 submitIntake が
   書く shape そのまま — version/tasks/target/autonomy/status/submitted_at）で
   ホーム v2 の home-flow ゲートを解放:
   - `ws-success`: ffmpeg で生成した実 3 秒動画 + 有効 edit.json（version 0・
     overlays 無し = rasterizer skip 経路・cuts 2 本）
   - `ws-lint-fail`: 同じ実動画 + `cuts[0].out <= cuts[0].in` で edit-lint が
     確実に FAIL する edit.json（`cuts.range` エラー 1 件）
   - `ws-broken`: 同じ実動画 + 壊れた JSON（`{ broken json ,,,`）の edit.json
   - `ws-agent`: `ws-success` の複製（エージェント経路の回帰確認・成果物
     フォルダは都度リセット）
3. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
4. **L1-3（パートナー端末バッファへの到達 = エージェント経路の無退行確認）だけ**は、
   実 claude/codex CLI のネットワーク越しブートストラップを避けるため、
   `AkariMenuWidget`（本タスクが所有する akari-shell-strip 側のファイル。
   akari-partner 側は一切編集していない）の `postConstruct` に一時デバッグフック
   `globalThis.__akariMenuWidgetDebug = this` を追加し、`export-button`
   （f740707 系譜）と同じ手法でダミー CLI（`while IFS= read -r line; do
   printf 'ECHO: %s\n' "$line"; done`）を接続した端末へパケット到達を確認した
5. フックは証跡取得後（`scenario-d-agent.mjs` 実行後）に完全に削除してから
   最終ビルドし、フック不在の最終ビルドに対して `final-smoke.mjs` で
   フック非依存の項目（edit.json ゲート・未接続トースト・キャンセル no-op・
   この場で書き出す成功パス・メニュー/素材タブ回帰）をもう一度実測した
   （`hasDebugHook: false` を明示確認）
6. 「この場で書き出す」は実 UI 操作のみで検証: ボタンの実クリック + quick-pick
   4 連鎖への実クリック/実キーボード入力（`Input.insertText` + Enter/Escape の
   実キーイベント）。完了判定は実ファイルの存在 + `ffprobe` 実測
7. 後片付け: 起動した Electron は **PID から辿る子孫プロセス木を SIGKILL**
   （`launch.mjs#killElectronTree`）+ user-data-dir 文字列マッチの重複防御。
   `plugin-host` はコマンドラインに `--user-data-dir` を含まず親を失うと
   PPID=1 に孤児化する実測不具合を検証序盤で発見・修正済み（詳細は「検証中に
   判明した知見」参照）。各回 `ps aux` で全数ゼロを確認するまでリトライする
   `assertNoOrphans` で検収

## 実測結果

| シナリオ | 内容 | 結果 |
|---|---|---|
| A（`scenario-a-success.mjs`） | 実 mp4 fixture・パートナー未接続のまま「この場で書き出す」 | `a-00`〜`a-05`.png。書き出しボタン enabled → quick-pick 4 連鎖 → 実行中はボタン disabled（`書き出しを実行中です。完了までお待ちください。`）+ 自前の不確定バー「この場で書き出し中…」→ 完了で `この場での書き出しが完了しました` + `成果物を開く（exports/final.mp4）` + `レポートを開く`。**実ファイル実在・サイズ 50589 バイト・`ffprobe` 実測 `h264/aac, 320x180, duration=1.8s`**。成果物リンクの実クリックで `final.mp4` タブが実際に開く。既存 `.akari/render.json` 監視パネル（render-cut 自身が書く実物）も同時に `書き出し完了（100%）` を表示 = 併存確認。既存メニュー/素材タブ無退行。console error 0 |
| B（`scenario-b-lint-fail.mjs`） | lint FAIL fixture（`cuts.range`）で「この場で書き出す」 | `b-01`/`b-02`.png。`lint NG — 書き出しを中断しました` + バッジ `lint 1 件`。**`exports/final.mp4` 不生成・`.akari/render.json` 不生成 = render-cut が起動されていないことを実ファイル不在で確認**。`lint レポートを開く` クリックで `edit-lint-report.html` タブが実際に開く。ボタンは書き出し中断後に再有効化。console error 0 |
| C（`scenario-c-broken.mjs`） | 壊れ edit.json + lint OFF で「この場で書き出す」 | `c-01`.png。render-cut 自身が exit 2 で失敗 → `この場での書き出しに失敗しました` + stderr 末尾要約 `render-cut execution error: edit.json is not valid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)` を画面にそのまま表示。`exports/final.mp4` 不生成。ボタン再有効化。console error 0 |
| D（`scenario-d-agent.mjs`。フック使用・証跡取得後に除去） | 「エージェントに任せる」= 現行パケット注入の無退行 | `d-00`〜`d-08`.png。edit.json 無し→disabled+ツールチップ→作成で reactive 有効化（既存回帰と同一）。quick-pick 4 連鎖の末尾で「エージェントに任せる」選択時、パートナー未接続なら**未接続トースト**（既存文言と同一）が出て注入なし・ローカル実行パスは一切起動されない（ボタン disabled 固着なし）ことを確認。キャンセル no-op。ダミー端末接続後、既定値/カスタム値の両方で**依頼パケット全文が一字一句到達**（`export-request-packet.ts` の固定テンプレートと完全一致）。console error は xterm.js 由来の既知ノイズ 1 件のみ（後述） |
| final smoke（`final-smoke.mjs`。**フック除去後の最終ビルド**） | フック非依存項目の最終確認 | `final-smoke-01`/`02`.png。`window.__akariMenuWidgetDebug` が `undefined`（フック不在）確認済みの上で、edit.json ゲート・未接続トースト・キャンセル no-op・**この場で書き出す成功パス**（カスタム解像度/ファイル名 `final-smoke.mp4` で実ファイル生成）・素材タブ回帰の全項目を再実測。console error **0**（D で観測された xterm ノイズすら無し = 経路依存の既知ノイズであることを裏付け） |
| 隔離・後片付け | 全 5 回の起動・終了 | 各回 `ps aux` で `plugin-host` を含む子孫プロセス木の残存ゼロを確認（`assertNoOrphans` が PID ツリーベースで再検証するまでリトライ） |

## 設定 → CLI 引数の対応表（`src/common/quick-export-cli.ts`）

| 設定 quick-pick | 直接実行パスでの扱い | 根拠 |
|---|---|---|
| 解像度プリセット（1080p 横/縦・正方形） | **CLI 引数化されない（正直な縮退）**。UI にも常時注記 `解像度プリセットはこの実行方法には反映されません（edit.json の出力設定がそのまま使われます）` を表示 | `packages/render-cut` の CLI は `<project-root> [--plan-only] [--out <path>] [--force]` のみで解像度引数を持たない。出力解像度は `edit.json` の `output.width`/`output.height` から決まる（`packages/render-cut/src/plan.mjs`）。エージェント経路は無改造のため、依頼パケット文言には従来どおり解像度ラベルを含める（スキル側が解釈する余地を残す） |
| 出力ファイル名 | `render-cut <projectRoot> --out exports/<sanitized-name>` | ディレクトリ区切り・`..` は `sanitizeQuickExportOutputName()` で剥がしファイル名 1 段に矯正してから `exports/` 直下に固定（パス脱出防止）。空/`.`/`..` のみは既定名 `final.mp4` にフォールバック |
| lint を先に再実行する（既定） | ON: `edit-lint <projectRoot> --json` を先に実行し、`verdict !== 'pass'` なら **render-cut を起動せず**中断（`findings.length` を `lint N 件` バッジ表示）。OFF: edit-lint を呼ばず直接 render-cut へ（render-cut 自身が `.akari/lint.json` の verdict を見て pass 以外なら refuse する既存挙動に委ねる） | `packages/edit-lint` の exit code 契約（0 PASS/1 FAIL/2 実行エラー）をそのまま流用。`.akari/lint.json` は edit-lint が書く実物を render-cut がそのまま読む — 本拡張は仲介しない |
| 実行方法（この場で書き出す／エージェントに任せる） | 「この場で」: 新設 `AkariQuickExportService`（node backend）が上記 2 CLI を子プロセス実行。「エージェント」: 既存 `composeExportRequestPacket` + `akari.partner.injectPrompt` を無改造で流用 | オーナー裁定 2026-07-25（両モード制） |

完了判定（`determineRenderOutcome`）: `exit code === 0` **かつ** 出力ファイルが実在し **かつ** サイズ `> 0` の全てを満たした場合のみ成功。stderr は末尾 5 行に要約（`summarizeStderrTail`）して失敗表示に使う。

## 検証中に判明した知見（申し送り）

- **`__dirname` は本番ビルドで `apps/shell/lib/backend` に固定される**（`theia build` が backend を単一バンドルするため、`src/node/*.ts` 個々のファイル位置ではない — `akari-preview-service.ts` / `akari-project-service.ts` の既存コメントと符合）。CLI 探索候補はこれを踏まえ `resolve(__dirname, '../../../../packages/edit-lint/bin/edit-lint.mjs')`（4 階層上がモノレポルート）を主候補にし、`process.cwd()` 依存の候補（`npm start` 等で cwd が `apps/shell` になるケース）を保険として残した。当初 `akari-project-service.ts` の既存候補列をそのまま複製したところ実機で CLI 未検出（`edit-lint CLI が見つかりませんでした`）になり、実測で判明した
- **`plugin-host` プロセスはコマンドラインに `--user-data-dir` を含まない**ため、user-data-dir 文字列の `pkill -f` だけでは検出も終了もできず、Electron main を先に kill すると親を失って `PPID=1` の孤児として残り続ける実測不具合を検証序盤で発見。`launch.mjs` を Electron main の **PID から辿る子孫プロセス木**を正とする方式に修正し、以降の全シナリオで孤児ゼロを再検証した
- 本検証実行時、機材の `load average` が一時 60 台まで上昇する外部要因（無関係な別セッションの同時実行）があり、quick-pick 操作の待ち時間を吸収するため `waitForQuickInputPlaceholder` 等のタイムアウトを大幅に引き上げ、かつ「直前の確定操作（Enter 押下）が反映されず据え置きになる」ケースを吸収する再送ガード（`confirmFilenameAndWait`）を追加した。アプリ本体の挙動そのものに起因する失敗ではない
- D で観測された `window.error: Uncaught Error: This API only accepts integers` は `export-button` の検証記録と同一（xterm.js の resize 整数丸め挙動・ダミー端末アタッチ経路にのみ出現）。フック除去後の final smoke では該当経路が無いため再現せず（console error 0）で裏付け済み

## 未確認事項

- 実 claude/codex CLI（実ネットワーク越しのインストール・実ログイン）を使った検証は本環境では未実施（ダミー CLI 代替は task.md 許容範囲）
- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみ）
- 電子署名済みパッケージ版（asar 化・配布用ビルド）での CLI パス解決は未検証（`packages/edit-lint`/`packages/render-cut` を配布物に同梱する仕組み自体が現状無い — private start の開発チェックアウト運用が前提）
