# r5c-track-z: 未宣言プロジェクトのバイト等価 実測（L2 受け入れ条件 #2）

`timeline.tracks` を宣言しない既存プロジェクト相当の fixture 3 本
（多 track cuts + layers／xfade transition／chroma_key video レイヤー）を実装の
前後で実レンダリングし、出力 mp4 の sha256 が一致することを確認する。

Chrome 依存の overlays/captions ラスタライズは対象外にしている。この sandboxed
shell 環境では headless Chrome がどのラスタライザでもタイムアウトする
（`hyperframes`/`puppeteer-core` は node_modules 未導入で不可、
`static-screenshot` は `--headless=new --no-sandbox --disable-gpu` でも
spawnSync がタイムアウトする——`dangerouslyDisableSandbox` でも再現。
`packages/render-cut/test/cli.test.mjs` が同じ症状を既知のサンドボックス制約として
`t.skip` する前例あり）。この環境制約は本タスクと無関係で、overlays/captions 合成
コードパス自体は本タスクで変更していない（`render-cut.mjs` の
`rasterizeAndComposite` 呼び出しは無改造）。

```sh
node packages/render-cut/evidence/track-z-byte-equivalence/check-byte-equivalence.mjs --baseline   # 実装前に1回
node packages/render-cut/evidence/track-z-byte-equivalence/check-byte-equivalence.mjs --verify      # 実装後
```

## 結果

`baseline-results.json`（実装前）と `verify-results.json`（実装後、ラッパーが
独立に再実行）:

| fixture | 判定 |
|---|---|
| multi-track-cuts-with-layers | BYTE-IDENTICAL |
| sequential-transition | BYTE-IDENTICAL |
| chroma-key-video-layer | BYTE-IDENTICAL |

3 fixture 全て sha256 完全一致。`timeline.tracks` 未宣言の既存プロジェクトの出力は
本タスクの変更後も変更前とバイト等価であることを実測で確認した。
