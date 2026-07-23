# real-run — ラッパー独立実測（2026-07-23）

`../README.md`（codex 作成）は L0 のみで、L1（実機 Electron + raw CDP）はサンドボックス制約
（GUI 起動・localhost listen が拒否）で未実施だった。本ディレクトリはラッパー（Claude Code）
自身が実機で行った独立 L1 実測の記録。`node_modules` は他 worktree からの symlink 流用のため、
`node_modules/akari-annotations` が `file:` 依存の相対 symlink 経由で **別 worktree（main リポ）の
extensions/akari-annotations** を指す既知の罠を発見（`resources/scripts/ensure-file-deps-linked.mjs`
は既存 symlink をスキップするため踏み抜く）。symlink を本 worktree の `extensions/akari-annotations`
へ張り直し、`rm -rf lib && npm run build` で再ビルドしてから検証した（bundle.js に新コードが
含まれることを `grep akari-annotations-strip-clip-source` で確認済み）。

## 実測手順

1. `apps/shell/node_modules` を隣接 worktree から symlink（依存インストール省略）
2. `node_modules/akari-annotations` symlink を本 worktree の `extensions/akari-annotations` へ張り替え
3. `npm run build:ext`（exit 0）→ `npm run lint`（exit 0）→ `npm run build`（browser/node/electron
   すべて 0 errors）を本 worktree 上で直接実行（tmp コピーではなく実体で検証）
4. `templates/project-default/` を `/tmp` の隔離ワークスペースへコピーし、fixture を配置して
   Electron を `--remote-debugging-port` + `--user-data-dir` + `--no-sandbox` で直接起動、
   raw CDP（`evidence/timeline-tracks/scripts/cdp-lib.mjs` を利用）で接続

## 実測結果

| # | 検査 | 結果 | 実測値 |
|---|---|---|---|
| 1 | v1 3 clips が `s1,s2,s1` の badge を cut 順に持つ | **PASS** | `../scripts/run-l1.mjs` をそのまま実行し、badge 順・data-akari-source-id が一致 |
| 2 | 各 clip のサムネイルが参照 src の画素と一致 | **PASS** | 中央画素 `[254,0,0], [0,0,254]（≒blue）, [254,0,0]` = 赤・青・赤 |
| 3 | 同一 in/out（`s1:0-1` と `s2:0-1`）でキャッシュ取り違えなし | **PASS** | 2 clip の `backgroundImage`（data URI）が異なることを実測 |
| 4 | v1 選択時のインスペクターに `src`/`source path` | **PASS** | `src: s1`, `source path: source-red.mp4` |
| 5 | 未定義 src の cut 1 件だけ劣化（他 2 件は継続表示） | **PASS**（cold-load 再実測） | `edit-invalid-src.json` を初期状態に置いた新規プロセスで 2 clips（`s1`=赤`[254,0,0]`, `s2`=青`[0,0,254]`）。他は既存 fixture のまま |
| 6 | v0 は badge 無し・従来の analysis videoUri を使う非退行 | **PASS**（cold-load 再実測） | `edit-v0.json` を初期状態に置いた新規プロセスで 2 clips、`sourceId`/`sourcePath` とも `null`、画素は赤 `[254,0,0]`（従来どおり analysis の `source-red.mp4`） |

screenshot: `01-v1-source-thumbnails.png`（項目 1-4 実行時）、`02-invalid-src-degrades.png`（項目 5）、
`03-v0-nonregression.png`（項目 6）。

## 既知の限界（本実測でのみ判明、機能側の不具合ではない）

`../scripts/run-l1.mjs` は単一プロセス内で `Page.reload()` により fixture を差し替える設計だが、
このワークスペース隔離構成では reload 後に一時的に clip 要素が 0 件のまま 15 秒のポーリング上限に
達する再現性の低い事象を観測した（beats-band evidence の「fileService.onDidFilesChange の実機ハーネス
限界」と同系統の、本検証ハーネス特有の制約と判断）。項目 5・6 はそれぞれ独立プロセス（fixture を
起動前に静的配置、cold load）で再実測し、いずれも実際の DOM・画素で PASS を確認済み。したがって
機能自体（parseEdit の劣化規約・sourceMap 解決・キャッシュキー・badge・インスペクター）の正しさは
実測で担保されている。
