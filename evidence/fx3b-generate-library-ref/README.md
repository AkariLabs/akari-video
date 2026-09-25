# FX-3b 生成の送信でライブラリの素材を読む — 証跡

## 再現の形（一時プロジェクト・FX-3 と同じ）

- edit.json の `sources[].path` = `assets/still/bg-aurora-mesh/bg.png`（プロジェクト相対）
- `.akari/asset-references.json` に `{ "id": "bg-aurora-mesh", "category": "still" }`
- 実物はライブラリ（`AKARI_HOME` の `library-location.json` が指す置き場）の `still/bg-aurora-mesh/bg.png` にだけある
  （1,288,777 bytes・sha256 `f9c16d342a4a06ab1fc5a12cf4f0f0d96291dd0d909e243c22e058b1d57503a4`）
- 外部の生成 API は呼ばない: `fetch` を差し替えて、送信直前の要求を記録してから止める

## BEFORE（修正前）

`akari video <project> --item clip-01 --dry-run --json` の時点で、送信の要求を組み立てる前に落ちる（外部送信 0 回）。

- `media-ref.mjs` の `makeReference`（`readFileSync`）→ ENOENT（最初の絵の参照を作るところ）
- `media-ref.mjs` の `resolveMedia`（`statSync`）→ ENOENT（アダプタが data URI を作るところ）
- `--from-image assets/still/bg-aurora-mesh/bg.png` は「プロジェクト内に見つかりません」で拒否

スタックは `before-stack.txt`。

## AFTER（修正後）

- CLI: 同じ fixture で `--dry-run` は exit 0（`image_url` に data URI が入る・外部送信 0 回）。送信ありでは差し替えた `fetch` まで届く（ENOENT なし）
- 実機（アプリ）: クリップを選ぶ → 編集 → 動画にする → 「動画にする」→ 費用承認する、で生成の CLI が起動し、
  送信直前の要求（POST `minimax/h3/image-to-video`）の `image_url` がライブラリの bg.png のバイトそのもの
  （sha256 一致・`after-submit-request-summary.json`）
  - `after-send-form-library-still.png` — 最初の絵にライブラリの静止画が入った送信フォーム
  - `after-cost-approval-dialog.png` — 費用承認の画面（この先の送信は差し替えた `fetch` で止めた）
- 下書き（`bg.png.meta.json` の `next.inputs.first_frame`）の `path` はプロジェクト相対の宣言パスのまま、`sha256` はライブラリの実ファイルのもの。ライブラリの絶対パスは書かれない
- 境界: 絶対パス・`..` でプロジェクトの外・台帳に無い id・id のディレクトリの外へ逃げる symlink は拒否。プロジェクトに実物があればそちらが優先（`packages/generate/test/cli/library-media-ref.test.mjs`）
