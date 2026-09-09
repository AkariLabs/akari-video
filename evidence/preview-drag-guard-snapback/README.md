# preview-drag-guard-snapback — L1 証跡（実機 Electron）

出力プレビューでの移動・拡縮・クロップが「離した位置で確定し、元に戻らない」ことを実機で確認した記録。
BEFORE = 基点コミット（v0.1.60）、AFTER = 本ブランチ。**同じスクリプト・同じ fixture**で 2 回流した。

## 再現手順

```sh
cd apps/shell && npm run build          # BEFORE/AFTER それぞれのビルドで
node evidence/preview-drag-guard-snapback/run-l1.mjs --label after --out <出力先>
```

`run-l1.mjs` が行うこと（すべて隔離 tmp 内・リポジトリは無改変）:

1. `ffmpeg`（`packages/media-bin/vendor/darwin-arm64`）で 12 秒の赤／緑 mp4 を生成
2. **v2 プロジェクト**（V1 = 赤の cut・V2 = 緑 50% の重なりクリップ）と
   **v1 プロジェクト**（legacy `cuts[]` + `layers[]`）を作る
3. Electron を `--remote-debugging-port` / `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME` を
   隔離ディレクトリに向けて起動し、CDP でプレビュー webview の main world へ入る
4. 合成 PointerEvent で実際に掴んで動かし、`edit.json` の実値・選択枠の位置・
   `cutWrite` / `layerWrite` の呼び出しをその都度実測する
5. 起動した Electron は PID 指名で SIGTERM → SIGKILL、tmp は完全削除

## 結果

| シナリオ | 観測 | BEFORE | AFTER |
|---|---|---|---|
| (a) 下の cut を 20 回連続で移動 | 20 回すべて書き込み・確定 / `transform.x` 単調増加 | 20/20・単調増加 | 20/20・単調増加 |
| (a) 押下時に選択が生きているか | `selectedOnDown` | 20/20 | 20/20 |
| (b) cut ドラッグ中に外部が `edit.json` を書き換え | 掴んだ位置を保持して確定 | 保持・確定 | 保持・確定 |
| (c) v2 でクロップ確定 | `cuts[].crop.w` が書かれる | w=0.905 | w=0.905 |
| (d) v1 でクロップ不可の 1 文 | 通知バーの文言 | **出ない** | **「この編集データ（v1）ではクロップできません。v2 へ移行してください」** |
| (e) layer ドラッグ中に外部がモデルを変更 | ドラッグ中の DOM 値が保持されるか | **0 へ戻る（`heldThroughExternalWrite: false`）** | **保持（46.27・`true`）** |

- (e) が根本原因（refresh がドラッグ中の DOM を無条件上書きする）の再現。
  `before-e-during-external-write.png` では緑のクリップが中央（x=0）へ戻っており、
  `after-e-during-external-write.png` では掴んだ位置に留まっている
- (a)(b)(c) は BEFORE でも通る。この機体（frame-engine 有効）では cut のドラッグ値が
  選択プロキシ要素に載るため、`applyCutVisual` の上書きが cut では表に出ない。
  **layer ドラッグ（e）が同じ根本原因の観測できる面**だった
- 生データ: `l1-before.json` / `l1-after.json`（`scenarios.a` は 20 回分の各行を保持）

## L0

- `cd apps/shell && npm run build:ext` → exit 0
- リポジトリ root で `npm run test:shell` → tests 3231 / pass 3230 / fail 1。
  唯一の赤は `frame-engine bundle は生成元から再生成しても byte drift がない` で、
  作業ツリーに同期されていた**未コミットの** `generated/frame-engine.js` が原因（本変更とは無関係）。
  `packages/frame-engine/src` から esbuild で再生成したバンドルは基点コミットの
  `generated/frame-engine.js` と **byte 一致**（sha256 `7a3ff9ee…`）することを実測済みで、
  コミット対象の内容では緑になる
