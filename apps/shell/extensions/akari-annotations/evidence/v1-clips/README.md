# evidence: edit.json v1 クリップ素材

## fixture

`fixture/project/edit.json` は、赤の `s1`、青の `s2`、`s1` の再登場からなる 3 cuts の v1 fixture。
先頭 2 cuts は同じ `in=0` / `out=1` とし、src を含まないキャッシュキーなら取り違えが起きる条件に
している。`edit-invalid-src.json` は中央へ未定義 src の cut を 1 件混ぜた劣化 fixture、
`edit-v0.json` は単一 analysis `videoUri` を使う非退行 fixture。

実動画は次で再生成できる。

```sh
sh scripts/generate-fixture-videos.sh
```

## 自動実測

L1 driver は fixture を隔離 workspace へ配置し、Electron へ raw CDP で接続する。

```sh
node scripts/run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>
```

検査項目:

1. v1 の 3 clips が `s1,s2,s1` の badge と `source path` tooltip を持つ。
2. サムネイル data URI を Canvas へ描き、中央画素が赤・青・赤であることを実測する。
3. 同一 in/out の `s1` と `s2` で data URI と画素が異なり、キャッシュ取り違えがない。
4. 未定義 src の cut だけが警告付きで除外され、`s1,s2` の 2 clips は表示を継続する。
5. v0 は src badge を一切追加せず、従来の analysis `videoUri` から赤サムネイルを表示する。
6. v1 cut 選択時の読み取り専用インスペクターに `src` / `source path` が表示される。

## L0 実測

2026-07-23、`apps/shell` を `/tmp` へ複製し既存依存を参照する隔離環境で実測した。

| 検査 | 結果 |
|---|---|
| `npm run build:ext` | PASS（exit 0） |
| `npm run lint` | PASS（exit 0） |
| production build | browser / node / electron すべて 0 errors |
| `node --check scripts/run-l1.mjs` | PASS（exit 0） |
| parseEdit 直接検査 | v1 sources 2 件保持、3 cuts。未定義 src / v1 src 欠落は当該 1 件だけ除外。v0 は sources フィールド無し |
| 既存 fixture parse 非退行 | 8 fixtures（v0: 6、v1: 2）PASS |
| fixture 動画中央画素 | red=`[254,0,0]`、blue=`[0,0,255]` |
