[English](./edit-json-access.md) | **日本語**

# edit.json の読み方

## AI の読み方（契約 §5.2）

1. **edit.json / captions.json / motion/*.json を全文 Read しない**。`grep -n '"id": "<id>"'` → 該当行だけ Read → Edit。木の構造を見たいときは `grep -n '"kind": "group"\|"items": \['` のように外枠だけ読む
2. 書き込みは (a) edit-store のスクリプト API（§6）経由、または (b) 該当行の直接 Edit + 保存時 lint（write-gate 相当を CLI で通す）。**どちらでも lint ゲートは必ず通る**
3. 一括操作（「1:00 以降の字幕を 0.5 秒ずらす」等）は**AI がスクリプトを書く**（§6 の API を import）。前もって一括コマンドを用意しない
4. 動きを書くときは L0 プリセット / L2 アニメーターを既定にする（数個の値で済む）。L1 の手打ちキーフレームは主に人間がフォーカスモードで作る
5. **観察・手術のための CLI コマンド（`akari edit tree` / `move` / `group` …）は作らない**（オーナー裁定 2026-08-30。ファイルが API）

## 前提

`edit.json` / `captions.json` / `motion/*.json` は edit-store の正規直列化（契約 §5.1 =
1 レコード 1 行・`"id"` で始まる）で保存されている。正規形でない古いファイルは次の保存で
正規形になる。

## 読む

`grep -n '"id": "<id>"' edit.json` で対象を探し、該当行だけ Read する。木の外枠は
`grep -n '"kind": "group"\|"items": \[' edit.json`、字幕は
`grep -n '"id": "c-0042"' captions.json` で読む。

## 書く

- 点の変更は該当行を Edit し、`edit-lint <project>` で保存時 lint 相当を通す。
- 一括変更は `@akari-video/edit-store` のスクリプトで `openProject → 直す → save()` とする。
  [README の例](../../packages/edit-store/README.md#例)、
  [shift-captions-after.mjs](../../packages/edit-store/examples/shift-captions-after.mjs)、
  [speed-up-group.mjs](../../packages/edit-store/examples/speed-up-group.mjs)、読み取り専用の
  [tree-summary.mjs](../../packages/edit-store/examples/tree-summary.mjs) を参照する。

## 観察

`akari edit tree` のようなコマンドは作らない。木を件数に畳んで見るときは
`node packages/edit-store/examples/tree-summary.mjs <project>` を使う。

## 袋を小さく保つ

HTML は断片単位、motion はグループ単位に分ける。`captions.json` は 1 ファイルのままにする。
袋が 1 MB を超えたら分割を再検討する。
