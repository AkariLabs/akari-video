# session-status L1 evidence

録音セッションの状態可視化（task 2026-09-12-review-session-status-visibility）の実機証跡。

- 注釈パネル: セッション行の状態バッジ（録音済み / 文字起こし済み / コンパイル済み / 未完了）と
  `録音済み` 行の 1 行ヒント、見出し直下の説明
- レビューボード: 未コンパイル帯（`録音済みセッション（未コンパイル）N 件`）・列名の統一・
  `s-XXXX 由来` バッジ
- 一覧の editUri 非依存: **出力プレビューを閉じても**パネルの一覧が消えない

## 観測（`l1-observations.json`・v2 プロジェクト）

fixture = リポジトリ直下 `test-project`（v2 `edit.json`）+ `skills/compile-review-session/dev-fixtures/fixture-project`
の `review/`（`s-0001` recorded / `s-0002` を transcribed へ書き換え / `s-0003` recorded /
`s-0004` compiled + `compiledAnnotations: ["a-0002"]`）と `review.json`（`a-0001` typed・`a-0002` session）。

| 段 | 観測 |
|---|---|
| パネル（`panel-badges`） | 4 行 = `s-0004` コンパイル済み / `s-0003` 録音済み + ヒント / `s-0002` 文字起こし済み / `s-0001` 録音済み + ヒント。見出し直下に説明 1 行 |
| ボード（`board-initial`） | 列名 `未対応 2` / `対応済み 0` / `確認済み 0`。帯 = `録音済みセッション（未コンパイル）3 件`（`s-0001` / `s-0002` / `s-0003`、各行にコンパイルボタン）。カード `a-0002` に `s-0004 由来` |
| 出力プレビューを閉じる（`previews-before-close` → `previews-after-close`） | `akari-output-preview-…` 1 → 0。パネルの 4 行は**そのまま**（`panel-after-preview-close`） |
| プレビューを閉じたままパネルを閉じて開き直す | `panel-while-closed` = mounted false → `panel-after-reopen` で 4 行が再表示（`previews-at-reopen` = 0 件） |
| compile 相当の着地（`s-0003` を compiled 化 + `review.json` に `a-0003` 追加） | 帯 3 件 → **2 件**（`s-0003` が消える）・カード `a-0003` に `s-0003 由来`・列 `未対応` 2 → 3・パネルの `s-0003` が コンパイル済み |
| 帯の「コンパイル」ボタン（`compile-button-click`） | クリップボード = `review セッション s-0001 をコンパイルして`・トースト表示・`partnerWidgetFocused: false`（裁定 A どおりフォーカスを飛ばさない） |
| 読むだけの確認 | 実行後に `s-0001` / `s-0002` / `s-0004` の `session.json` が fixture と 1 バイト差なし（ハーネス外で `diff` 実測） |

## ファイル

- `run-l1.mjs` — Electron を実起動し CDP で操作する検証ハーネス（**ラッパー作成**。
  由来 = `akari-annotations/evidence/recording-band/run-l1.mjs`）
- `l1-observations.json` — 観測ログ（絶対パスは `<WORKTREE>` / `<TMP>` / `<HOME>` へ置換済み）
- `l1-01-panel-badges.png` / `l1-03-panel-after-preview-closed.png` / `l1-04-panel-after-panel-reopen.png`
- `l1-02-board-band.png` / `l1-05-board-after-compile.png` / `l1-06-board-compile-clicked.png`
- スクショは対象ウィジェットの矩形だけ切り出している（作業機の一時パスがタブに写り込むため）

## 再現

```sh
T=$(cd "$(mktemp -d)" && pwd -P)   # macOS の一時ディレクトリは symlink なので realpath を使う
cp -R test-project "$T/project"
cp -R skills/compile-review-session/dev-fixtures/fixture-project/review "$T/project/review"
cp skills/compile-review-session/dev-fixtures/fixture-project/review.json "$T/project/review.json"
rm -rf "$T/project/review/sessions/s-000"[5-9] "$T/project/review/sessions/s-0010"
node -e "const fs=require('fs');const p='$T/project/review/sessions/s-0002/session.json';
  const m=JSON.parse(fs.readFileSync(p,'utf8'));m.status='transcribed';
  fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n')"
node apps/shell/extensions/akari-annotations/evidence/session-status/run-l1.mjs \
  "$PWD/apps/shell" "$T/project" "$T/evidence" 9456
```

前提: `npm --prefix apps/shell run build`（`lib/` が必要）と
`apps/shell/node_modules/electron/dist/Electron.app` の存在。マイクは使わない（録音はしない）。
