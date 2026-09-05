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
2. **時刻を別の仕組みに持たせない。** タイミングは `data-start` / `data-duration` とする。AKARI Video v0 では `edit.json.overlays[].start/duration` が SSOT で、ランタイムが外側コンテナの data 属性へ反映する。断片内の独立した時刻源を作らない。
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

# リーフ目次

必要な判断領域だけを読む。

- 字幕・テロップの日本語組版、可読性、配置: [telop.md](telop.md)
- 表・グラフの HTML/CSS 構成とアニメーション: [table.md](table.md)
- Three.js + glTF、動画テクスチャ、3D 性能: [3d.md](3d.md)
- ガラス屈折の宣言、入れ子、ツマミ、静止背景: [glass.md](glass.md)
- 決定的モーション、イージング、compositor 制約: [motion.md](motion.md)
- サムネイルの型、デザイン語彙、生成経路、HTML スクショ: [thumbnail.md](thumbnail.md)
- 人物切り抜き、HEVC alpha、text-behind-person: [text-behind-person.md](text-behind-person.md)

静止サムネイル用 HTML シートは動画オーバーレイではないため timing data 属性を不要とする。ただし、CSS 変数化、単一ルート、ローカル資産、決定的なスクリーンショットという考え方は維持する。
