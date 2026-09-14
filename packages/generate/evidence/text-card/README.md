# L1 実測 — 文字カードの Chrome 描画（2026-09-14）

タスク「文字カードの Chrome 描画」の実機検証記録。作業機の絶対パスは
`<WORKTREE>` / `<HOME>` / `<TMP>` へ置換して書く。

## 1. `akari generate still --placeholder` の実行

- 入力: `packages/generate/test/fixtures/cli-still/l1-project/` を `<TMP-PROJECT>` へ複製
  （`AKARI_HOME` は一時ディレクトリへ退避）
- コマンド: `node packages/akari-launcher/bin/akari.mjs generate still <TMP-PROJECT> --spec <TMP-PROJECT>/beats.json --placeholder`
- 結果: **完了 3 枚・失敗 0 枚・スキップ 0 枚**（exit 0）
- 所要: 3 枚で総経過 **4.05 秒**（実効 **1.35 秒/枚**）
- 描画経路: **chrome**（3 枚とも）
- 解決した Chrome: `<HOME>/.cache/puppeteer/chrome-headless-shell/mac_arm-152.0.7977.42/chrome-headless-shell-mac-arm64/chrome-headless-shell`
  （`find-chrome.mjs` の `findChrome()` が返し、`headless: "shell"` + `pipe: true` で起動）

stderr には次の 3 行を記録した。

```text
文字カード morning-desk: renderer=chrome
文字カード leaving-desk: renderer=chrome
文字カード garden-path: renderer=chrome
```

3 枚の meta はすべて `status=planned`・`output.resolution=1920x1080`・
`provenance.tool=akari generate still --placeholder (chrome)` だった。

## 2. PNG の機械確認と目視

証跡: [`leaving-desk-chrome-1920x1080.png`](./leaving-desk-chrome-1920x1080.png)

- 42244 bytes、1920x1080
- 背景は RGB (32, 32, 32) = `#202020`
- RGB 各 220 以上の白画素は 7774 個で、すべて中央帯（y 360〜719 / x 200〜1719）の中
- 目視で id「leaving-desk」、name「席を立つ」（大・白）、prompt 先頭
  「人物が椅子から立ち上がり机を離れる瞬間、横からのミディアムショット」（薄字）、右下「planned · 文字カード」が読める
- PNG のチャンクは `IHDR` / `IDAT` / `IEND` のみで、メタデータ由来のパス漏れなし

## 3. 決定論

同一入力を 2 回描いて SHA-256 が一致した。テスト「実 Chrome は同じ入力を 2 回バイト一致で描く」と、
ラッパーの独立スクリプトの両方で確認した。

## 4. 縮退経路の実測

ラッパーの独立スクリプトから `renderTextCard` を直接呼び、注入で経路を無効化した。

| 条件 | 経路 | 出力 |
|---|---|---|
| puppeteer あり（既定） | chrome | 1920x1080 / 54043 bytes |
| `loadPuppeteer` → `null` + 同梱 vendor ffmpeg | ffmpeg-drawtext | 1920x1080 / 58263 bytes |
| `loadPuppeteer` → `null` + ffmpeg 解決不能 | solid | 1920x1080 / 8332 bytes |
| `puppeteer.launch` が例外 + 同梱 vendor ffmpeg | ffmpeg-drawtext | 1920x1080 / 58263 bytes |
| `loadPuppeteer` → `null` + PATH の ffmpeg 8.1.1（libfreetype 無しで drawtext 無し） | solid | 1920x1080 / 8332 bytes |

いずれも例外は投げず、1920x1080 の PNG を必ず作った。

## 5. 既知事実

この作業機の PATH 上の ffmpeg（Homebrew 8.1.1）は libfreetype 無しで、`-filters` に
`drawtext` が出ない。同梱 `vendor/darwin-arm64/ffmpeg` には `drawtext` がある。
`resolveFfmpeg()` は PATH 優先なので、Chrome 経路が無ければ既定解決では solid まで落ちる。
これが本票で Chrome を一次経路にした理由である。
