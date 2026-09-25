# FX-3 ライブラリの素材のパスの読み替え — 実機の証跡

## 再現の形（一時プロジェクト）

- edit.json の `sources[].path` = `assets/still/bg-aurora-mesh/bg.png`（プロジェクト相対）
- `.akari/asset-references.json` に `{ "id": "bg-aurora-mesh", "category": "still" }`
- 実物はライブラリ（`AKARI_HOME` の `library-location.json` が指す置き場）の `still/bg-aurora-mesh/bg.png` にだけある。プロジェクトの `assets/` は空

## BEFORE（修正前）

クリップを選ぶ → インスペクターの AI → 動画にする → 「このクリップの絵」で、インスペクターの上に

```
ENOENT: no such file or directory, realpath '<project>/assets/still/bg-aurora-mesh/bg.png'
```

が出て、最初の絵のサムネイルも「画像を表示できません」になった（画面の写しはローカルのパスを含むので、ここには置かない）。

## AFTER（修正後）

- `after-timeline-library-still.png` — タイムラインのフィルムストリップとプレビューがライブラリの絵を描いている
- `after-first-frame-selected.png` — 同じ操作で ENOENT が出ず、「最初の絵」にライブラリの絵が入り、見積と「動画にする」ボタンの送信前の画面まで進む（外部の生成 API は呼んでいない）
- 書かれた下書き `assets/still/bg-aurora-mesh/bg.png.meta.json` は**プロジェクトの中**にでき、`next.inputs.first_frame` = `{ path: "assets/still/bg-aurora-mesh/bg.png", sha256: <ライブラリの bg.png の sha256 と一致> }`。ライブラリ側のファイルは変わっていない
