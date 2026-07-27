---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-25
---

# export-options L1 検証手法・証跡

タスク: `2026-07-25-export-options`（quick-export の quick-pick 連鎖に 画質・エンジン・
fps・出力先の 4 問を追加し、render-cut CLI の `--progress` 出力を解釈した詳細進捗
（% + 経過/残り時間 + ログ展開）を表示する）の実機検証記録。

## 手法（verify スキル L1 節に準拠）

1. `apps/shell` を `PYTHON=/usr/bin/python3 npm run build`（`build:ext` →
   `theia build --mode production`）でビルド（electron の `dist/` は既存キャッシュから
   利用済みだったため再展開は不要だった）
2. リポ外に隔離ワークスペースを作成し、`.akari/intake.json`
   （`status: "submitted"` を含む、`packages/schemas/fixtures/intake/valid-submitted/`
   と同シェイプ）でホーム v2 の home-flow ゲートを解放（メニュー/素材アイコンが
   出現する条件。パートナー接続は不要）
3. `ffmpeg -f lavfi testsrc2 ...` で実ソース動画を生成（最初は 4 秒/640x360、
   進捗バーの実移動を確認するため 1920x1080/90 秒へ差し替え）+ 有効な edit.json
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=9333 --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動（`THEIA_CONFIG_DIR` も同じ隔離dirへ）
5. `playwright-core` を検証用の隔離ワークスペースにのみ `npm install`（リポジトリ本体には
   追加していない）し `chromium.connectOverCDP` でアタッチ。本ディレクトリの
   `screenshot.mjs` / `click-and-shot.mjs` / `key-and-shot.mjs` / `find-and-click.mjs`
   が実際に使った最小ドライバ（quick-pick はキーボード操作 `ArrowDown`/`Enter` で確定）
6. 後片付け: 起動した Electron 系プロセス（main/renderer/gpu/network/ipc-bootstrap の
   実 PID）を `ps aux` で拾って個別 `kill` → 残存分は `kill -9` → 最終確認で
   `l1-electron-userdata` / `l1-gui-workspace` を含むプロセスがゼロであることを確認

## 検証した項目とスクリーンショット

| # | 内容 | ファイル |
|---|---|---|
| 1 | 解像度 quick-pick（既存・無改造） | `01-quickpick-resolution.png` |
| 2 | 新規: 画質 quick-pick（標準（既定）/高画質 crf18 相当/軽量 crf26 相当） | `02-quickpick-quality.png` |
| 3 | 新規: エンコーダ quick-pick（自動（既定）/ハードウェア VideoToolbox/ソフトウェア x264） | `03-quickpick-encoder.png` |
| 4 | 新規: fps quick-pick（そのまま（既定）/24/30/60） | `04-quickpick-fps.png` |
| 5 | 新規: 出力先 quick-pick（既定 exports/ 直下 / フォルダを選ぶ…） | `05-quickpick-outputdest.png` |
| 6 | 解像度縮退注記の文言更新確認（「解像度は edit.json の出力設定に従います」） + lint 実行中の不確定バー | `06-resolution-note-wording-and-linting.png` |
| 7 | 回帰: lint FAIL で書き出しが中断（render-cut 未起動）。実 edit-lint が返した 9 件の findings がバッジ表示 | `07-regression-lint-fail-abort.png` |
| 8 | 新規: 「ログを表示」トグルで生ログ（edit-lint の JSON 出力）を展開 | `08-log-toggle-expanded.png` |
| 9 | 新規: 詳細進捗 t1（45%・経過 01:54・残り約 02:19） | `09-progress-45pct-t1.png` |
| 10 | 新規: 詳細進捗 t2（56%・経過 02:16・残り約 01:47）— t1 から実際に前進していることを確認 | `10-progress-56pct-t2.png` |
| 11 | 書き出し完了（100%）+ 既存の render.json 由来パネル（「書き出し中（planned）」表記）が同時に描画され続けている = render.json 監視は無改造 | `11-completed-100pct.png` |
| 12 | 回帰: 「エージェントに任せる」を選ぶと既存の `akari.partner.injectPrompt` 経路がそのまま動作し、未接続トーストが表示される（依頼パケット自体は無改造） | `12-regression-agent-path-toast.png` |

t1/t2 は同一の書き出し実行中に ~22 秒間隔で撮った 2 時点（画質=高画質・エンコーダ=
ソフトウェア(x264) を明示選択し、1920x1080/85 秒のクリップを意図的に低速化させて
複数時点を捕捉した）。

## 実測結果の要点（バックエンド CLI 側、`packages/render-cut` 直接実行）

- 既定（新引数なし）と `--quality standard` は **SHA256 完全一致**（`buildVideoEncodeArgs`
  が quality/encoder 両方未指定のとき何も足さない設計どおり、ffmpeg のデフォルト
  crf23/preset medium と `--quality standard` の明示値が数値的に同一のため）
- `--quality high/light` はそれぞれ crf18/26 相当でファイルサイズが単調に変化
  （light 326,811B < standard/既定 429,402B < high 568,955B、同一 4 秒フィクスチャ）
- `--encoder videotoolbox` / `--encoder auto`（本機は VideoToolbox 対応）は
  ffprobe の `TAG:encoder` で `h264_videotoolbox` を実測。`--encoder x264` および
  `AKARI_EXPORT_FORCE_X264=1 --encoder auto` は `libx264` を実測
- `--fps 24` / `--fps 60` は ffprobe の `r_frame_rate` で反映を確認
- 絶対パスの出力先（`--out <外部ディレクトリ>/file.mp4`）は実ファイルがそのパスに出力
- GUI からの既定設定書き出しでも子プロセス argv は `[projectRoot, '--out', 'exports/<name>',
  '--progress']` — `--progress` 以外の新規フラグは付かない。`--progress` は
  render-cut 側で `plan.commands`（ひいては ffmpeg の実エンコードパラメータ）を
  一切変更しないラッパー（`-progress pipe:1` を子プロセス起動時にのみ前置し、
  out_time= を自前の PROGRESS 行に変換するだけ）であることをコードと
  `packages/render-cut/test/cli.test.mjs` の専用テストで担保している

詳細な対応表・全実測ログは内部リポの該当タスク記録を参照。
