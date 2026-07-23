# render-cut v1 multi-source evidence

`render-evidence.mjs` は一時ディレクトリに赤素材 A と青素材 B を生成し、v1 の
`A (0.6s) -> B (0.8s) -> A (0.7s)` を実際に render-cut で書き出す。
出力の 0.3s / 1.0s / 1.7s を PNG に抽出し、`l2-result.json` に ffprobe 実測値と
中央画素の RGB を記録する。素材と MP4 は一時ディレクトリから削除され、リポジトリには
コミットしない。

```sh
node packages/render-cut/evidence/render-cut-v1/render-evidence.mjs
```

期待する目視順:

1. `frame-01-a.png`: 赤（素材 A）
2. `frame-02-b.png`: 青（素材 B）
3. `frame-03-a.png`: 赤（素材 A の再登場）
