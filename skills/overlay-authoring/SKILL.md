---
name: overlay-authoring
description: AKARI Video のオーバーレイ HTML、字幕、表・グラフ、Three.js 3D、モーショングラフィックス、サムネイル、人物の後ろに文字を置く表現を設計・生成・レビューするときに発動する authoring ルーター。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

次のいずれかに違反する動画オーバーレイを作成・採用しない。詳細リーフより常に優先する。

`edit.json` / `captions.json` は全文 Read せず、id で grep して該当行だけ読む（[edit.json の読み方](../../docs/guides/edit-json-access.md)）。
書き込みは該当行の Edit か edit-store のスクリプト API を使う。

1. **調整値を直書きしない。** 位置、拡縮、文字サイズ、色、余白、内容など、人が調整しうる値を CSS 変数として公開する。`--font-size`、`--color`、`--block-left` のような非予約名を使い、`edit.json.overlays[].vars` から継承できるよう `var(--name, fallback)` で参照する。断片ルートで同名変数を再定義して上書きを遮らない。
   **`--x` / `--y` / `--scale` / `--rotate` はランタイム予約変数**（`packages/render-cut/src/rasterize.mjs` の `renderOverlayNode` が `.akari-overlay-container` へ必ずインライン設定する。値は `overlays[].transform` 由来、`role==="background"` なら恒等値に固定）。断片内でこの 4 変数を**参照（`var(--x, ...)`）することも自前用途で再定義することも禁止**する。継承によりフォールバックが効かず、指定値が無視されて全オーバーレイが原点（0,0・scale 1・rotate 0）へ寄る（実機バグ報告 `overlay-css-var-collision`、2026-08-17。edit-lint は PASS・レンダーも成功するため目視まで気づけない）。位置・拡縮・回転のノブは `--block-left` / `--block-scale` のような非予約名を自分で定義する。
2. **断片ルートに時刻を置かない。** タイムライン上の開始・長さは `edit.json` が正本で、ランタイムが外側コンテナへ反映する。断片ルートに `data-start` / `data-duration` を置かない。素材本来の長さが必要なら `data-akari-natural-duration`（秒）に記録し、断片内の演出はクリップ先頭を 0 とするローカル秒で書く。
3. **layout を毎フレーム動かさない。** アニメーションは `transform` / `opacity` 中心にする。4K 映像上の `filter: blur()` と `backdrop-filter` は禁止する。
4. **wall-clock で絵を決めない。** `Date.now()`、`performance.now()` の経過差、`setTimeout`、`setInterval`、rAF の delta 積算、未 seed の乱数に表示状態を依存させない。シーク時に WAAPI の `currentTime` を設定すれば同じ時刻の絵が再現される決定的設計にする。
5. **3D の別方式を持ち込まない。** 3D は Three.js + glTF とし、動画テクスチャは `VideoTexture` に編集用プロキシを与える。原本をプレビュー用テクスチャへ直結しない。
6. **トップレベルを複数にしない。** HTML 断片のルート要素は必ず 1 つにする。AKARI の外側コンテナによる translate / scale / rotate が常に効く構造を保つ。

## ポインタ当たり判定

ランタイムが作る全画面コンテナと HTML 断片のルート要素は、余白で下の映像やレイヤーを
選べるよう既定で `pointer-events: none` になる。背景、枠、影、文字、画像・動画・canvas・SVG
などを実際に描く可視の子孫だけ、ランタイムが機械判定して `pointer-events: auto` へ戻す。

機械判定と異なる当たり方が必要な場合は、対象要素または範囲の祖先へ
`data-akari-hit="catch"`（配下で拾う）/ `data-akari-hit="pass"`（配下を素通し）を付ける。
最寄りの明示指定が配下へ継承され、機械判定より優先される。透明なドラッグ面など意図がある
場合だけ `catch` を使い、全画面ルートへ安易に付けない。

## プレビューで直接触れる要素

これは FORBIDDEN 級のハードルールではない（守らなくても絵は壊れない）が、class も `id` も無い要素は後からプレビューで個別に直す対象にならない。
人が直接触りそうな要素は、次の形で作る。

- `id` か class を持つ要素だけがプレビューで直接選べる対象になる。どちらも無い要素を押すと、class か `id` を持ついちばん近い親が選ばれる想定で作る。
- 棒・ラベル・見出し・アイコン・カードには、意味のある class（`bar`、`value-label`、`legend-item`、`card-title` など）を見た目用のユーティリティ class より前に置く。番地には先頭の class が使われる。
- 同じ役割の要素には同じ class を付ける（棒 5 本ならすべて `bar`）。番地は同じ class の何番目かで決まるので、増減・並べ替えで番号がずれて隣を指しうる。その断片に要素ごとの上書き（`edit.json` の `source.elements`）が掛かっていれば見直す。
- SVG は 1 枚の絵として選べる対象になり、中の `rect` や `text` は個別の対象にならない。棒 1 本・ラベル 1 つを触れるようにしたい図は div + CSS で組み、SVG はアイコン・ロゴ・曲線など 1 かたまりで動けば足りる絵に使う。
- 1 文字ずつ `span` に割る演出では、各 `span` に class が無ければ見出し全体が 1 つの選択対象になる。1 文字ずつ触らせたいときだけ付ける。
- 棒や箱の仕上がりの寸法は `width` / `height`（px）で決め、隣の要素は flex / grid で並べる。箱を変えると隣の要素が組み直る。`transform: scale()` で寸法を作らない。出現の演出は、終わりが等倍になる `transform`（例: `scaleY(0)` → `scaleY(1)`）と `opacity` で付け、仕上がりの寸法は `width` / `height` だけで決まるようにする。
- 名札（`data-akari-part`）は、その要素だけ別の時間・動きを持たせ、タイムラインに行として出したいときのもの。
  class は位置・回転・箱を直せれば足りる要素の目印。名札については [object-tree 契約 §1.3〜1.4](../../docs/contract-2026-08-30-edit-json-v2-object-tree-v0.md) を参照する。
- class 名は `bar` のような役割の一般名でよい（番地は断片内で数える）。CSS のセレクタは従来どおり断片固有のルート配下に閉じる（例: `.sales-chart .bar`）。

要素の上書きは `translate` / `rotate` / `width` / `height` を使う設計で子の `transform` に触れないため、[motion.md](motion.md) の外側コンテナの幾何操作と子の演出用 `transform` は両立する。

# リーフ目次

必要な判断領域だけを読む。

- 字幕・テロップの日本語組版、可読性、配置: [telop.md](telop.md)
- 表・グラフの HTML/CSS 構成とアニメーション: [table.md](table.md)
- Three.js + glTF、動画テクスチャ、3D 性能: [3d.md](3d.md)。端末の画面・キーの生成や反射調整は [device-materials.md](device-materials.md) も読む。
- ガラス屈折の宣言、入れ子、ツマミ、静止背景: [glass.md](glass.md)
- Canvas 2D 世界、DOM シート同期、俯瞰: [world.md](world.md)
- 新しい描画の種類は `packages/overlay-runtime/runtimes.mjs` のマニフェストへ登録する（追加手順: `packages/overlay-runtime/README.md`）。
- 決定的モーション、イージング、compositor 制約: [motion.md](motion.md)
- サムネイルの型、デザイン語彙、生成経路、HTML スクショ: [thumbnail.md](thumbnail.md)
- 人物切り抜き、HEVC alpha、text-behind-person: [text-behind-person.md](text-behind-person.md)

静止サムネイル用 HTML シートは動画オーバーレイではないため timing data 属性を不要とする。ただし、CSS 変数化、単一ルート、ローカル資産、決定的なスクリーンショットという考え方は維持する。

ライブラリへ収めるオーバーレイの `meta.json` は素材契約 v1 の `tier` を必ず宣言する。例: `"tier": "free"` と `"license": { "spdx": "CC0-1.0", ... }`。Pro は `"tier": "pro"` とし、`license.spdx` に `CC0-1.0` を指定しない。階層は本人に確認する（[素材 tier 契約](../../docs/contract-2026-10-04-asset-tier-v1.md)）。
