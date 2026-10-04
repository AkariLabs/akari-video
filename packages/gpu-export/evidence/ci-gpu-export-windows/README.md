# gpu-export Windows CI テスト修正の根拠

対象は Windows の CRLF チェックアウトで再現した 6 件。改行は読み取ったソース文字列だけを LF に正規化し、ソースの構造や実行結果に対する照合条件を維持する。製品のパス生成はホスト OS の `path` に従っており、製品コードの修正は不要。

| 失敗したテスト | 原因 | 修正内容 | 修正前後で確かめている中身 | 修正後の実測結果 |
|---|---|---|---|---|
| `caption-batching.test.mjs:136` 字幕測定の凍結状態 | 改行。読み取ったソースが CRLF だと `cssVariants` の前後の `\n` に一致しない | `page-runtime.js` を読み取った直後に CRLF を LF へ正規化 | 測定とラスタが同じ確定状態を使うこと、測定キーに `cssVariants` が所定の位置で含まれること、凍結 CSS の用途と回数 | LF・CRLF とも合格 |
| `caption-batching.test.mjs:254` 重複フォント除去 | 改行。関数切り出しの `\n\n  function captionRasterBand` が CRLF では見つからない | 同じ正規化済みソースから元の区切りで関数を切り出す | 最初のプレースホルダー用 `@font-face` だけを残し、無関係のフォントを残すこと | LF・CRLF とも合格 |
| `page-builder.test.mjs:462` raw フレームのパス | パス区切り。Windows の `path.join` が `\` を返す | 出力パスの親、`raw`、フレーム名を `path.join` で組み立てて厳密比較 | dump フレーム番号の整列と重複除去、`raw/frame-12.rgba` の配置、併用禁止オプションの拒否 | LF・CRLF とも合格 |
| `runner.test.mjs:11` tier 2 の GPU エントリー | パス区切り。実パスの `\` が `/` 固定の正規表現に一致しない | テストファイルからの期待パスを `path.join` で組み立てて厳密比較 | tier 2 が GPU 用 Electron main を使い、readback・bitrate・quality・soft のフラグを渡すこと | LF・CRLF とも合格 |
| `runtime-cuts.test.mjs:25` gpu-export の `normalizedCuts` | 改行。関数終端の `\n  }\n` が CRLF では見つからない | 読み取ったソースを正規化してから同じ区切りで切り出す | 下層トラックの逐次配置、上層トラックの `at` と `track` の保持、既存の正規化規則 | LF・CRLF とも合格 |
| `runtime-cuts.test.mjs:25` osr-export の `normalizedCuts` | 改行。同じ終端区切りが CRLF では見つからない | gpu-export と共通の読み取り箇所で正規化する。osr-export のソースは変更しない | gpu-export と同じトラック配置および正規化規則 | LF・CRLF とも合格 |

同じ種類の潜在的な改行依存がある `empty-plan-runtime.test.mjs`、`layer-failure.test.mjs`、`quantizer-wiring.test.mjs`、`vgpu-stateful.test.mjs` も読み取り直後に正規化した。`runner.test.mjs` のデスクトップ実行ファイル探索用プローブも OS の区切りで末尾を照合する。

## 実測（Windows 11・Node 24.20.0）

基点は `origin/main` の `f1c942fbb`、修正後は本修正。それぞれ LF と CRLF の作業ツリーで確認した。

| 条件・確認項目 | 基点 | 修正後 | 補足 |
|---|---|---|---|
| 作業ツリー LF（`core.autocrlf=false`）の全 516 件 | pass 513 / fail 2 / skip 1 | pass 515 / fail 0 / skip 1 | 基点の失敗は `page-builder.test.mjs:462` と `runner.test.mjs:11` |
| 作業ツリー CRLF（CI の `actions/checkout` と同じ `core.autocrlf=true` 相当）の全 516 件 | pass 509 / fail 6 / skip 1 | pass 515 / fail 0 / skip 1 | `packages/` 配下のテキストを CRLF に変換して再現。基点の失敗は CI の Windows ジョブの 6 件と同一集合 |
| skip 1 件 | `GPU and OSR karaoke highlight pixels agree at fill boundaries` | 同じ 1 件 | 本修正と無関係 |
| `npm run assert-zero-readback` | 緑 | 緑 | CRLF でも緑 |
| `npm run check:frame-engine-drift`（LF） | 緑 | 緑 | `src/` と `generated/` は無変更。CRLF では `generated/frame-engine.js` の改行により不一致になる。このチェックは Linux の `ci.yml` で実行され、Windows ジョブには含まれないため本修正の対象外 |
| CI Windows ジョブの後続ステップ（CRLF、同じ引数） | — | `osr-export ci:fixture --verify` 緑。`--soft --verify-frames` の 2 回実行で事前エンコードのフレーム SHA-256 が 360/360 一致し、`status=completed`。MP4 は両回とも 360 フレームで SHA-256 が一致。`--trap-readback` の readback カウンタは全 0 | この機械では H.264 エンコーダが使えた。CI の素の Windows Electron では `unsupported` になり得るが、ジョブが必須にするのはフレーム SHA の一致 |

Linux 前提を壊していないこと: CRLF→LF の置換は LF のソースを変えない。`path.join`・`dirname` は POSIX では従来の `/` 区切りの期待値と同じ文字列になる。runner の厳密比較は `GPU_ELECTRON_MAIN` と同じ絶対パスを POSIX・Windows とも返す。
