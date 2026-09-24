# OSR 書き出しで字幕の動き（textanim）を字幕ごとに閉じる — 実機 L1 の証跡

タスク: `task/2026-09-24-osr-caption-anim-scope`（基点 `f744273e`）。

## 直したこと

OSR は全字幕のオーバーレイを 1 枚の文書（`/overlay-sheet.html`）に並べる。字幕の断片（render-cut `captions.mjs`）は
それぞれ `<style>` に `.akari-caption__plate { animation: … }` などの規則を持つので、文書全体に効き、後に並ぶ字幕の規則が勝っていた
（動きだけでなく block / frame-fit / runs / 強調 / 1 文字ずつの規則も同じ）。

`packages/osr-export/src/caption-style-scope.mjs` が、OSR の静的サーバーが `/overlay-sheet.html` を配る直前に、
字幕の断片ごとに root へ `data-akari-caption-scope="…"` を付け、その断片の `<style>` の通常の規則のセレクタを
その root の中だけに限定する（`.akari-caption__x` → `.akari-caption[data-akari-caption-scope="…"] .akari-caption__x`、
`.akari-caption--single-line .x` → `.akari-caption--single-line[data-akari-caption-scope="…"] .x`）。
`@font-face` / `@keyframes` と宣言の中身は変えない（`akari-anim-*` は同名なら中身も同じ）。
想定外の規則は手を付けずに残し、書き出しは止めない。overlay sheet が無い（GPU 書き出しの `null`）ときは素通し。

buildOsrPage が返す `overlaySheetHtml` 自体と render-cut の断片は変えていない（GPU・プレビューが共有するため）。

## 方法（`scripts/l1.mjs`）

- fixture: 1280×720・30fps の単色映像に字幕 3 本（4 秒刻み・各 3 秒）
  - `anim3`: c-0001 = fade-up（in/out）+ float（loop）/ c-0002 = pop + breath / c-0003 = spin-in + wobble
  - `styled`: c-0001 = fade-up + 文字範囲（runs・紫）に run の animation（loop float）/ c-0002 = pop + 強調 one-char-bang（1 文字ずつ）/ c-0003 = 動き無し
- `render-cut --engine osr` で (a) 3 本まとめたプロジェクト（sheet）と (b) 字幕 1 本だけのプロジェクト（single・カット = その字幕の区間 → 出力 0〜3 秒）を書き出す
- 各字幕の in / loop / out の途中（+0.3 / +1.5 / +2.7 秒）のフレームで、背景からの色差の重心（cx, cy）・色差 > 60 の外接矩形（w, h）・ink を測り、sheet − single を比べる
- 許容差（契約）: 重心 ±0.002・矩形 ±0.007（フレーム比）

再現: `node scripts/l1.mjs before`（変更前）/ `node scripts/l1.mjs after`。ffmpeg と Electron（OSR）が要る。単体テストは使わない。

## 結果（`results-before.json` / `results-after.json`）

dcx / dcy / dw / dh = sheet − single（フレーム比）、ink比 = sheet / single。

| セット | 字幕 | 時刻 | BEFORE dcx / dcy / dw / dh / ink比 | AFTER dcx / dcy / dw / dh / ink比 |
|---|---|---|---|---|
| anim3 | c-0001 | in | 0.0001 / **0.0042** / 0 / 0 / 0.964 ✗ | 0 / 0 / 0 / 0 / 1 ✓ |
| anim3 | c-0001 | loop | 0.0004 / 0.0016 / 0 / 0.0028 / 0.949 ✓ | 0 / 0 / 0 / 0 / 1 ✓ |
| anim3 | c-0001 | out | **0.0058 / −0.007 / −0.0843 / 0.1653** / 0.633 ✗ | 0 / 0 / 0 / 0 / 1 ✓ |
| anim3 | c-0002 | in | 0.0004 / 0 / −0.0032 / 0 / **0.648** ✓（位置は許容内だが不透明度が違う） | 0 / 0 / 0 / 0 / 1.002 ✓ |
| anim3 | c-0002 | loop | 0.0001 / −0.0004 / −0.0016 / 0.0014 / 0.964 ✓ | −0.0001 / 0 / 0 / −0.0014 / 1.001 ✓ |
| anim3 | c-0002 | out | **−0.0032 / −0.0282 / −0.1273 / 0.1861** / 0.353 ✗ | −0.0002 / 0 / 0 / 0.0013 / 1.004 ✓ |
| anim3 | c-0003 | in | 0.0002 / −0.0001 / 0 / 0 / 0.996 ✓ | −0.0002 / 0 / 0 / 0 / 1 ✓ |
| anim3 | c-0003 | loop | 0 / 0 / 0 / 0 / 0.998 ✓ | 0 / 0 / 0 / 0 / 1.009 ✓ |
| anim3 | c-0003 | out | 0 / 0.0002 / 0 / 0 / 1.002 ✓ | −0.0001 / 0.0004 / 0 / 0 / 1.007 ✓ |
| styled | c-0001 | in | 0.0001 / **−0.0095** / 0 / 0 / 1.444 ✗ | 0 / 0 / 0 / 0 / 1 ✓ |
| styled | c-0001 | loop | 0.0001 / 0.0001 / 0 / −0.0014 / 0.98 ✓ | 0 / 0 / 0 / 0 / 1 ✓ |
| styled | c-0001 | out | −0.0003 / **−0.0096** / 0 / 0 / 1.43 ✗ | 0.0001 / 0 / 0 / 0 / 1 ✓ |
| styled | c-0002 | in | **0.0028** / −0.0002 / **−0.0211** / −0.007 / 0.897 ✗ | −0.0002 / 0 / 0 / 0 / 1.003 ✓ |
| styled | c-0002 | loop | −0.0001 / 0.0002 / 0.0008 / 0 / 0.979 ✓ | 0 / 0 / 0 / 0 / 1.002 ✓ |
| styled | c-0002 | out | −0.0019 / −0.0004 / **−0.0289** / −0.0042 / 0.887 ✗ | −0.0002 / 0.0001 / −0.0007 / 0.0027 / 1 ✓ |
| styled | c-0003 | in / loop / out | 0 / 0 / 0 / 0 / 1 ✓ | 0 / 0 / 0 / 0 / 1 ✓ |

- BEFORE: 最後に並ぶ字幕（anim3 の c-0003・styled の c-0003 = 動き無し）の規則が全字幕に効き、他の字幕の動きが消える / 違う動きになる
- AFTER: 18 時刻すべて許容内（最大 |dcx| 0.0002・|dcy| 0.0004・|dw| 0.0007・|dh| 0.0027・ink比 1.000〜1.009）
- **字幕 1 本だけの書き出しは不変**: single の 18 フレームの SHA-256（rgb24）が BEFORE / AFTER で全一致（基準値の再固定なし）
