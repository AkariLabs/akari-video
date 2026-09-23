# シェル断片プレビューの BEFORE / AFTER

中立な v2 fixture（640×360、30 fps、静止画背景、HTML 断片 4 枚）を一時 workspace で実行した。書き出し比較は `akari capture --engine osr -t 0.5 1.5 3.0 --separate --full`。npm Electron の launcher tier は **2**、capture の engine は `requested=osr / resolved=osr`、stamp は 15/45/90f の全 3 枚で一致した。

## 証跡一覧

| ファイル | 内容 |
|---|---|
| `before/fixture-a1.html`〜`fixture-a4.html` | 操作前の断片。A-2 は 2 本、A-3 は 3 本の CSS アニメを各要素に指定。A-4 は相対 img の 0/48px 親と data URI の 0px 親 |
| `before/observations.json` / `after/observations.json` | CDP の操作・時刻別 computed style・画像の intrinsic / 表示寸法 |
| `before/a1-final.html` / `after/a1-final.html` | インライン編集後の断片。元は `before/fixture-a1.html`。前後 diff は下記 |
| `before/shell-*.png` / `after/shell-*.png` | Electron シェルの 0.5 / 1.5 / 3.0 秒 |
| `before/osr-*.png` / `after/osr-*.png` | 同じ時刻の OSR フレーム。前後の OSR は各時刻で PNG バイト一致 |

## BEFORE

- A-1: 選択、SE ツマミ操作では断片は 285 バイトのまま一致。インライン編集 `A &amp; B` → `C &amp; D` の後、285 → 471 バイトへ変化。`@font-face` と img の相対参照が 2 行の `127.0.0.1:<port>/asset/` に変わり、`style="--a:1px;--b:2"` も DOM 書式へ変わった。続くドラッグでは断片に追加差分なし。壊れた断片に対する OSR capture は未宣言の network asset として拒否した。
- A-2: **再現せず**。0.5 秒は One、1.5 秒は Two、3.0 秒は Three が退場中で先行する 2 語は opacity 0。各要素の 2 本の WAAPI timing は delay 200/900 ms 等、fill `both`/`forwards` を保持した。本文の `data-akari-3d-scene` 文字列だけでは 3D 宣言が作られなかった。
- A-3: **中央集合は再現せず**。0.5 秒は Alpha 中央、1.5 秒は Alpha が Y=-42px・Beta が中央、3.0 秒は Alpha が opacity 0・Beta が退場中・Gamma が上方へ退く途中。3 本すべての delay/fill が保持された。
- A-4: 相対 img と data URI img はともに `complete=true` / `naturalWidth=48`。それでも 0px 親の両画像は表示矩形 0×0、48px 親だけ 24.9×24.9 CSS 表示 px。computed style は `max-width:100%; max-height:100%`。親の `overflow:visible; contain:none` なので原因はクリップや URL 解決ではなく、この画像寸法制約だった。

## AFTER

- 選択・SE ツマミの後、断片は元の 285 バイトと完全一致。インライン編集後は `C &amp; D` のテキスト節だけ変化して 285 バイト、`127.0.0.1` 行は 0。続くドラッグ後も同じバイト列。相対 font/img と CSS の空白は元のまま。
- A-2/A-3 の computed opacity / transform は BEFORE と各時刻で一致し、OSR と同じ配置。比較用 OSR PNG は修正前後で 3/3 枚バイト一致。
- A-4 は 0px 親の相対 img と data URI img の両方で `max-width:none; max-height:none`、表示矩形 24.9×24.9 CSS px。48px 親の版も 24.9×24.9 CSS px で、3 枚とも OSR と同じ位置に表示された。

断片の通常保存は元ソースのテキスト節だけを書き換え、セッション資産 URL が残る候補は書き込み前に例外として拒否する。構造が変わるインライン編集は安全に対応できないため拒否する。

## 静的検証

- `apps/shell: npm run build:ext` / `npm run build`: exit 0。
- `apps/shell: npm run lint`: exit 0（別拡張の既存 warning 1 件、error 0）。
- 初回修正時の `akari-preview: node --test test/*.test.mjs`: 1,413 pass / 0 fail。

## 差し戻し r2 の確認

slot の既定文字とその子孫を、params 描画後の HTML から書き戻さないようにした。slot の子要素が params 描画で消える場合も対象。CRLF / CR は比較時だけ LF にそろえ、未編集ノードの元バイト列を保つ。両ケースは `test/fragment-source-write.test.mjs` に追加した。上の Electron 画像は初回修正時の観測であり、r2 の実機再測定はマシンの高負荷により省略した。

- `npm run build:ext`: exit 0。
- `npm run lint`: exit 0（既存 warning 1 件、error 0）。
- `node --test test/fragment-source-write.test.mjs`: 6 pass / 0 fail。
- `node --test test/*.test.mjs`: 1,415 件中 1,414 pass / 0 fail / 1 cancelled。境界外の caption 大量 RPC テストが 180 秒の timeout。該当テスト単独の再実行も同じ timeout だった。
