---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-25
---

# materials-tab-hardening L1 検証手法・証跡

タスク: `2026-07-25-materials-tab-hardening`（素材タブ hardening — 未整理セクション + watch +
サムネキャッシュ）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし（Node 22+ 組み込みの
`fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は `catalog-tab`（77c2312）と同じ共有ヘルパーを
ベースに、本タスク専用の `ensureDeveloperModeOff`（後述）を追加した。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペース（リポ外）へコピーし、
   `.akari/intake.json`（`status: "submitted"`）でホーム v2 の home-flow ゲートを解放
3. フィクスチャ実体（すべて ffmpeg 実生成の実メディア。読み取り専用の `~/Movies/AkariVideo/**`
   には一切触れていない）:
   - プロジェクトルート直下（非再帰対象）: `clip.mp4`・`frame-01.png`・`narration.wav`
     （未整理として拾われるべき 3 種）+ `edit.json`（契約 JSON — 未整理から除外されるべき）
   - `exports/legacy-output.mp4`（ディレクトリ内 — 非再帰スキャンなので対象外）
   - `assets/clip.mp4`（衝突ターゲット。ルートの `clip.mp4` と同名で先に配置）
   - `assets/unanalyzed-video.mp4` / `assets/unanalyzed-image.png`（analysis sidecar なし —
     ffmpeg サムネ生成の対象）
   - `assets/analyzed-clip.mp4` + `.akari/sidecars/assets/analyzed-clip.mp4.analysis/`
     （`analysis.json` + `keyframe-01.png` — analysis keyframe 優先の対象）
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動
5. **developer mode の環境依存事故と対策（透明性のため記録）**: この開発機の
   `~/.theia/settings.json`（`--user-data-dir` では隔離されない共有ファイル — catalog-tab
   README で既知の挙動）に `akari.developerMode: true` が残っていたため、起動直後は
   素材タブではなく標準 Explorer が表示された。`toggleDeveloperModeViaSettings`
   （catalog-tab 由来）は無条件トグルのため、既に OFF のときに誤って ON へ戻す事故が
   実際に一度発生した。再発防止のため、チェックボックスの現在値を見てから必要なときだけ
   クリックする冪等版 `ensureDeveloperModeOff` を `cdp-lib.mjs`（本タスク専用コピー）に
   追加し、以降の全 phase の先頭で必ず呼ぶ方式に統一した。検証完了後、`~/.theia/settings.json`
   の `akari.developerMode` は開始時の値（`true`）へ実際に戻し、他のキー
   （`security.workspace.trust.trustedFolders` 等）は一切変更していない
6. **ffmpeg 不在フォールバック（L1-4 後半）の検証手段**: task.md は「ffmpeg を PATH から
   外した環境変数で起動」を指示するが、実測の結果 `lib/backend/main.js` が起動時に
   無条件で `fix-path`/`shell-env`（`@theia/core/electron-shared/fix-path` 経由）を呼び、
   ユーザーのログインシェル（`zsh -ilc`）を再実行して PATH を丸ごと再導出することが
   判明した——このマシンには `/etc/paths.d/homebrew` が存在するため、Electron 起動時に
   どう env を渡しても（`env PATH=...` で起動プロセス自体には反映されることを
   `ps eww` で確認済み）、`lib/backend/main.js` 側の `process.env.PATH` は必ず
   `/opt/homebrew/bin` を含む形に上書きされ、env 経由の隔離ではこのアプリの
   ffmpeg 解決を意図通り止められないことを実地で確認した。そのため実手段として、
   `/opt/homebrew/bin/ffmpeg`（symlink）を同ディレクトリ内で一時的にリネーム
   （`ffmpeg.materials-tab-hardening-l1-backup`）して `which ffmpeg` を実際に失敗させ、
   検証直後に確実にリネームを戻した（`which ffmpeg` で実体が元通り解決することを実測確認済み。
   リネームしていた時間はこのマシン上で他プロセスが ffmpeg を必要とする窓を最小化するため
   2 分未満）。これはアプリの実装コードの欠陥ではなく検証環境（fix-path の設計）に起因する
   制約であり、`resolveMaterialThumbnail`/`generateThumbnail` 自体は `which`/`where` の
   実行結果のみを見て判定するため、ffmpeg 実体が本当に無い状態を再現できれば検証としては
   同等である
7. 送信・受信は実 UI 操作のみで検証: カード上の「assets へ移動」ボタンの実クリック +
   `ConfirmDialog`（Theia 標準）の実ボタンクリック（承諾/キャンセル） + quick-input への
   `Input.insertText` による実キーボード入力。watch の実測は本ドライバとは別プロセス
   （このスクリプト内の `execFile('ffmpeg', ...)`/`fs.rm` — 実 OS レベルの外部ファイル操作）
   で `assets/` とプロジェクトルート直下を変更し、タブを開き直さずカード一覧が更新される
   までの経過時間を実測した
8. 後片付け: 各 Electron インスタンスは実 PID を指定して kill 後、`ps aux` で
   `materials-hardening-ws` / `user-data-*` を含むプロセスの残存ゼロを確認
   （main・Helper (Renderer)・Helper (GPU)・Helper (utility)・`lib/backend/main.js` の
   全 6 プロセス種を含む）。さらに全実行終了後、ワークスペースパスを含まない孤児
   `plugin-host` プロセスもマシン全体の `ps aux` スイープで確認したが、本タスクの
   起動由来のものは検出されなかった（他 worktree/実アプリの無関係なプロセスのみ存在）

## 実測結果（詳細は `run-log-phase*.json` / スクリーンショット）

| # | 項目 | 結果 |
|---|---|---|
| L1-1 | ルート直下 mp4/png/wav が「未整理」バッジ付きで表示。`.akari/`・`edit.json`・`exports/` 内は対象外 | `01-materials-tab-initial.png` + `02-unorganized-badges.png`。実測 `unorganizedPaths: ["clip.mp4","frame-01.png","narration.wav"]`（3件ちょうど）・`data-akari-unorganized-count=3`。全カードパスに `edit.json`/`exports/`/`.akari/` の混入なし |
| L1-2 (拒否) | 「assets へ移動」→ 警告ダイアログ → キャンセル → 何も起きない | `03-move-warning-dialog.png` + `04-cancel-no-op.png`。実測ダイアログ文言「narration.wav を assets/ 直下へ移動します。edit.json がこのファイルをルート相対パスで参照している場合、参照が壊れる可能性があります（edit.json は自動的に書き換えません）。」キャンセル後もカードは未整理のまま・トースト増加なし |
| L1-2 (承諾・衝突なし) | 「assets へ移動」→ 警告ダイアログ → 承諾 → 実ファイル移動 + カードが assets セクションへ | `05-move-no-collision-done.png`。`frame-01.png` → `assets/frame-01.png`（実 `ls` 確認済み）。ルート側のカードは消滅 |
| L1-2 (承諾・同名衝突) | 同名衝突 fixture で連番回避を実測 | `06-move-collision-numbered.png`。ルート `clip.mp4`（既存 `assets/clip.mp4` と同名）を移動 → `assets/clip-2.mp4` として実体化（実 `ls -la` でサイズ照合: `clip-2.mp4`=23062B〔ルート原本と一致〕・`clip.mp4`=32888B〔衝突ターゲット原本のまま不変〕）。上書きなし |
| L1-3 (assets/ 追加) | 外部プロセスでの追加がタブ開き直しなしで反映 | `08-watch-asset-added.png`。実測: 別プロセス（`execFile('ffmpeg', ...)`）で `assets/watch-added-clip.mp4` を追加 → 1168ms でカード出現（デバウンス 300ms 込み） |
| L1-3 (assets/ 削除) | 同上、削除で消滅 | `09-watch-asset-deleted.png`。518ms でカード消滅 |
| L1-3 (ルート直下 追加/削除) | 未整理セクションもタブ開き直しなしで追随 | `10/11-watch-root-*.png`。追加 433ms・削除 413ms でそれぞれ反映 |
| L1-4 (優先順位) | analysis keyframe > cache > プレースホルダ | `12-thumbnail-priority.png`。実測 `<img src>`: `assets/analyzed-clip.mp4` は `.akari/sidecars/assets/analyzed-clip.mp4.analysis/keyframe-01.png`（analysis keyframe）、`assets/unanalyzed-video.mp4`/`assets/unanalyzed-image.png` は `.akari/cache/thumbnails/<hash>.{jpg,png}`（実ファイル `ls` で 8 件実在確認）。console error 0 |
| L1-4 (ffmpeg 不在) | PATH から ffmpeg を外した環境 → プレースホルダ運用・console error 0 | `17-ffmpeg-missing-boot.png` + `18-ffmpeg-missing-placeholder.png`。ffmpeg 実体を一時退避した別 Electron インスタンスで実測: 未分析動画/画像カードは `<img>` 無し・プレースホルダアイコン（`codicon-device-camera-video`/`codicon-file-media`）表示・`.akari/cache/thumbnails/` に新規ファイル 0 件・`window.__errCount === 0`。分析済みカード（`analyzed-clip.mp4`）は同一実行内で従来どおり keyframe 表示（回帰なし） |
| L1-5 回帰: ドロップ取り込み | 無退行 | `13-drop-import-regression.png`。`classifyDropped` の `text/uri-list` フォールバック経路（real `FileList` を script から構築できないため既存実装の代替分岐を実 DragEvent で駆動）を実 DOM drop で駆動し、実ファイル `assets/drop-source-regression-clip.mp4` が実際に複製されカード化することを確認 |
| L1-5 回帰: lint バッジ | 無退行 | `14-lint-badge-regression.png`。`edit.json` 実在下でバッジ「Lint 10 件」表示（fixture の `edit.json` が参照する overlay ファイル欠落由来の findings。実装側の回帰ではない） |
| L1-5 回帰: カタログタブ | 無退行 | `15-catalog-tab-regression.png`。開発配置フォールバックで実 `catalog/` を自動検出 — `itemCount=24, missingCount=36`（catalog-tab タスクの実測値と一致） |
| L1-5 回帰: 「エージェントに頼む」 | 無退行 | `16-ask-agent-regression.png`。quick-input 実入力 + Enter → パートナー未接続時の実トースト文言「パートナー未接続。ホームの「パートナーに接続する」から接続してください」が変わらず出ることを確認 |
| 隔離・後片付け | 実 Electron 隔離起動 + 終了時 kill + 孤児プロセス確認 | 各回 `ps aux` で `materials-hardening-ws`/`user-data-*` を含むプロセス残存ゼロを確認。ffmpeg 実体は検証直後にリネームを戻し実体復旧を確認、developer mode preference も開始時の値へ復元 |

## L0（単体テスト・静的検査）

- `npm run build:ext`: exit 0
- `npm run lint`: exit 0
- `apps/shell/extensions/akari-project` の `npm test`: **46/46 pass**
  （既存 27 件 + 新規 19 件: `isUnorganizedRootEntry`/`classifyUnorganizedMediaKind` 9 件
  〔対象拡張子分類・非対象拡張子・未整理判定〔ディレクトリ常時除外/ルート直下契約 JSON 除外/
  既存 hidden ポリシー除外/サイドカー拡張子除外/メディア拡張子でないもの除外〕〕・
  `deriveThumbnailCacheKey`/`thumbnailCacheFileName` 8 件〔決定論性・path/size/mtime いずれか
  変化での別キー化・安全なファイル名生成・拡張子正規化〕・`nextCandidateAssetName` 4 件
  〔stem-index.ext・拡張子なし・ドットファイル・複数ドット〕）

## 設計裁定の実装確認

- 未整理判定はプロジェクトルート**直下のみ**（非再帰）。ディレクトリは常に除外するため
  `assets/`・`exports/`・`.akari/` はスキャン対象にすら入らない
- 未整理判定の対象拡張子は task.md 指定どおり狭い集合（動画 mp4/mov/webm・音声 wav/mp3/m4a・
  画像 png/jpg/jpeg/webp）— 素材タブの通常分類（`classifyKind`）より狭い専用規約として
  `unorganized-materials.ts` に分離
- 「assets へ移動」は `edit.json` を一切書き換えない（契約ファイルへの書き込み禁止）。
  移動前に必ず `ConfirmDialog`（Theia 標準コンポーネント）で警告し、キャンセル/クローズは
  no-op。同名衝突は `recordDroppedAssets` と同じ `stem-index.ext`（index は 2 から）の
  連番規約に倣う（既存の複製規約とは独立した実装だが、命名結果は同一規約）
- watch は `FileService.watch(root)`（既定 `recursive: false` — プロジェクトルート直下のみ）
  と `FileService.watch(assetsUri, { recursive: true })`（assets/ 配下は全階層）の 2 本を
  張り、`onDidFilesChange` を関連パスでフィルタしてから 300ms デバウンスで `loadMaterials()`
  を再実行する
- サムネキャッシュは `.akari/cache/thumbnails/` 以外へ一切書かない。キーは
  `path + size + mtime` から SHA-256 導出（16 桁 hex）。ffmpeg は `which`/`where` で
  PATH から解決し、失敗時は例外を投げず `{ available: false }` を返す（呼び出し側は
  プレースホルダへ黙ってフォールバック——コンソールエラー・例外・トースト一切なし）
- やらないこと（task.md 指示4）はすべて未実装のまま: assets/ 下位分類の自動整理・
  ルート以外の深い階層走査・edit.json の参照リライト・レガシー `cache/`（ルート直下）の
  移行・analyze-footage の自動起動・カタログ/プラン/書き出しへの変更・スキーマ変更

## 未確認事項

- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみで検証）。`which`/`where`
  切り替えはコードレビュー範囲で確認済みだが実機検証は macOS のみ
- 実 claude/codex CLI（実ネットワーク越し）を使った「エージェントに頼む」到達確認は
  本環境では未実施（未接続時の実トースト文言確認までを回帰確認の範囲とした。task.md の
  回帰要件は「無退行」の確認であり、パケット到達確認は本タスクの新規スコープではないため）
