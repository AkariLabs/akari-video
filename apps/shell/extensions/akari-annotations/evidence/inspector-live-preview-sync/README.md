# inspector live preview sync — L1 証跡

インスペクターの数値欄を**タイプしている最中**（確定前）に出力プレビューが追従するか、実 Electron で確かめる。
`run-l1.mjs` が (a)〜(d) を一続きに assert し、各手順の出力プレビューを PNG 連番で `shots-<label>/` に書く。

## 前提

- `apps/shell/node_modules/electron/dist/Electron.app` が存在すること
- `npm --prefix apps/shell run build`（`lib/backend/electron-main.js` が必要）が完了していること
- fixture は `dev-fixtures/cross-track-image-overlap`（v1 = 赤の全画面 / v4 = 緑の 50% 中央）を一時領域へ複製して使う
- `AKARI_HOME` は一時ディレクトリを渡す（本物の `~/.akari` は触らない）。スクリプトが自分で作る

## 実行

```sh
# frame-engine クロック（既定）
node apps/shell/extensions/akari-annotations/evidence/inspector-live-preview-sync/run-l1.mjs
# 従来クロック
AKARI_FRAME_ENGINE=0 AKARI_CDP_PORT=9452 \
  node apps/shell/extensions/akari-annotations/evidence/inspector-live-preview-sync/run-l1.mjs
```

Electron は `spawn`（detached にしない）で 1 本だけ起動し、`finally` で SIGTERM → SIGKILL してから
一時領域を消す。

## 測るもの

出力プレビューのステージ矩形だけを切り出して撮り、`ffmpeg` で 320x180 の RGB へ落として
「赤の重心 X / 緑の重心 X / 緑の外接矩形」を数える。画面撮影は色管理を通って純色から外れるため、
絶対値ではなく優勢チャネルで赤・緑を判定する（`dev-fixtures/cross-track-image-overlap/run-l1.mjs` と同じ流儀）。

## 検証項目

| 手順 | 内容 | 期待 |
| --- | --- | --- |
| (a) | 上トラックの item を選び X 欄へ `3` `0` `0` を 1 打鍵ずつ | 打鍵ごとに live 値 3 / 30 / 300 が飛び、緑素材が右へ動く。`edit.json` は無傷 |
| (c) | 同じ item の回転欄へ `4` `5` | 打鍵ごとに live が飛び、45° で緑の外接矩形が正方形へ広がる |
| (b) | base トラックの帯を選び X 欄へ `3` `0` `0` | 打鍵ごとに live が飛び、赤の全画面が右へ動く |
| (b2) | `{kind:'item', id:'photo-a-item'}` をタイムラインと同じ CustomEvent チャネルへ流す | base トラックの v2 item（`summary.cuts` 側）がプレビューへ届く。未知の id は無視 |
| (d) | Escape / blur | Escape で欄・プレビューとも元値へ戻り `edit.json` は不変。blur で `transform.x = 60` が確定し、確定後の絵が確定前の live と一致 |

(b) について: この fixture の base 帯はインスペクターへ `{kind:'cut', index:0}` を送る（帯の
`data-akari-item-id` はトラック内 index の `"0"`）。`{kind:'item', id}` で base トラックの実体を
指す経路は (b2) で直接確かめている。

## 結果

`run-log-frame-engine.json` / `run-log-legacy.json`（どちらも `"status": "PASS"`）。
