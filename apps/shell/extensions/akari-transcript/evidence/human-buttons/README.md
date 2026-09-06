# 素材の文字起こし・字幕生成ボタンの検証証跡

以下はラッパーが実施した手順と実測値の記録。

## L0（決定論）

### 手順 + 実測

- `npm --prefix apps/shell run build:ext` 緑
- `npm --prefix apps/shell/extensions/akari-project test` = tests 252 / pass 252 / fail 0（変更前 241）
- `npm --prefix apps/shell/extensions/akari-transcript test` = tests 131 / pass 131 / fail 0（変更前 129）
- `npm run test:shell`: 変更前（`80c20f99`）tests 2701 / pass 2698 / fail 2、変更後 tests 2714 / pass 2712 / fail 2。
  失敗集合は同一の 2 本で、どちらも本変更と無関係の既存赤。
- 既存赤 1: apps/shell/test の「validate-asset の import は node: 組み込みモジュールだけを参照する」
- 既存赤 2: akari-preview の「shell fragment assets use shared resolution and registered stream URLs」。
  macOS の /var → /private/var シンボリックリンク由来。
- 台本パネル本文（`akari-daihon-widget.ts`）の「文字起こし」出現回数は変更前後とも 0。
  ボタン文言は `src/common/captions-button.ts` の純関数 `captionsButtonLabel` が持つ。
- `git diff --stat 80c20f99` は所有パスの 20 ファイルのみ（コードとテスト 13 + 本証跡 7 =
  README.md と png 6 枚）で、`lib/` の生成物を含まない。

## L1（実機 Electron tier 2 + CDP）

### 手順

- 敷設: `harness/prep-worktree-electron.sh`（node_modules/electron/dist + path.txt + native アドオン 7 種）
- ビルド: `npm --prefix apps/shell run build`（build:ext + theia build --mode production。0 errors）
- 起動: `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス> <隔離 ws 絶対パス> --remote-debugging-port=9333 --user-data-dir=<隔離> --no-sandbox`。
  THEIA_CONFIG_DIR も隔離。cwd = worktree ルート = 同梱ツール解決の cwd 候補が効く位置。
- 隔離 ws = `templates/project-default` のコピー + `assets/pv-10s.mp4`。
  内部リポ `fieldtest/2026-08-03-akari-video-pv/exports/pv-v8.mp4` の 6〜16 秒を ffmpeg で
  10 秒切り出し（h264 + aac）。edit.json v2 は sources 1 件（id=pv）、visual 2 トラック
  （カットと captions 参照）で、validate-edit OK。
- 素材カードの右クリックメニューは Theia のネイティブメニューではなく DOM ポップアップ
  （akari-project の `akari-context-menu.ts`）なので、CDP から実物を観測・クリックできた。
  段 1 の mode-switch 票と違い executeCommand の代替経路を使う必要がなかった。

### 実測

- メニュー実測 10 項目。順は open / add-to-timeline / reveal / copy-file / copy-path /
  show-info / **transcribe（ラベル「文字起こし」）** / rename / delete / ask-agent。
  「素材の情報を表示」の直後に入っている。
- 実行前: バッジ `data-akari-transcript-state=none`・文言「文字起こし 未」。
  台本パネルの大ボタンは「文字起こしして字幕を作る」（有効）。
- メニューの「文字起こし」をクリックした 3 秒後: バッジ = running「文字起こし 実行中」。
  `.akari/events/` に `status: running` のイベント 1 本。
  pgrep で子プロセスを実測 = `<worktree>/packages/akari-tools/bin/media.mjs transcribe assets/pv-10s.mp4`
  （Electron Helper = ELECTRON_RUN_AS_NODE 経由）。**CLI を再実装せず bin を spawn している証跡**。
  この間、台本パネルのボタンは disabled。
- 約 20 秒後: `.akari/sidecars/assets/pv-10s.mp4.analysis/analysis.json` が生成され transcript 長 = 2。
  バッジ = done「文字起こし 済」。events に `status: completed` が 1 本追加。
  台本パネルのボタンは**押さなくても**「字幕を作る」へ自動で切り替わった（.akari のファイル監視で追随）。
- 「字幕を作る」をクリック → captions.json が生成され captions 2 件
  （c-0001 0.00〜1.00「あ」/ c-0002 9.06〜10.30「。」）。
  台本パネルの行数 = 2、ヘッダの件数表示「2 行 / ?? 1」。
- 手直し済み経路: captions.json の 1 件目に `edited: true` を書いてから再度クリック →
  確認ダイアログ「手直し済みの字幕があります。上書きしますか」（キャンセル / 上書きする）が出る →
  「上書きする」で captions.json が再生成され、手で書き換えたテキストが元へ戻り edited が false になった。
- Electron のログにエラー 0。

### スクリーンショット

- [01-menu.png](./01-menu.png) = 素材カードの右クリックメニュー
- [02-badge-none.png](./02-badge-none.png) = 実行前のバッジ
- [03-badge-running.png](./03-badge-running.png) = 実行中のバッジ
- [04-badge-done.png](./04-badge-done.png) = 完了後のバッジ
- [05-captions-rows.png](./05-captions-rows.png) = 字幕生成後の台本パネル
- [06-force-dialog.png](./06-force-dialog.png) = 手直し済み字幕の上書き確認

### 実機で見つかったバッジの修正

既定の素材パネル幅（実測 165px・3 列）ではカードが 68px 角になり、56px のテキスト
「文字起こし 未」がバッジ内で 2 行に折り返してサムネイルの大半を覆った。
また、左下の位置が既存の「エージェントに頼む」丸ボタン（20px）と重なっていた。

この実測を受け、バッジを右下の 1 行表示へ変更し、左下ボタンの幅と余白を確保した。
ラベルだけを省略可能にし、状態語は縮めず残す。title と aria-label に全文を持たせ、
状態属性と半角スペースを含む textContent は維持する。

### 申し送り（この票では直していない既存挙動）

- 台本パネルのフッターは reload の成功時に文言を消さないため、captions.json が無い状態で
  一度出た「台本を読み取れません…」が、字幕生成に成功して行が並んだ後も残る。
  `80c20f99` でも同じ挙動で、本票の変更とは独立（footer をクリアする責務は既存 reload 側）。
