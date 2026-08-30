---
lifecycle: implemented
created: 2026-08-09
updated: 2026-08-30
---

# 変形キーフレーム契約 v0（`layers[].keyframes` / v2 `items[].keyframes`）— 2026-08-30 復元

> **復元の注記（2026-08-30）**: 本契約は `packages/schemas/edit.schema.json`（`layerKeyframe` / `layerItem` / `keyframeV2` の `$comment`）・
> `packages/schemas/bin/validate-edit.mjs`・`packages/render-cut/src/layer-keyframes.mjs` ほか 10 箇所から参照されていたが、
> 実ファイルがどのブランチの履歴にも存在しなかった。スキーマの `$comment` に残っていた意味論からそのまま再構成した。
> **後継 = `contract-2026-08-30-motion-and-keyframes-v0.md` §2**（opacity の追加・easing 語彙の拡張・`motion/` 袋への参照形）。
> 本ファイルは v0 の意味論の記録であり、これ以上追記しない。

- 日付: 2026-08-09（実装済み・`contract-2026-07-22-render-basics.md` §4-4 に要約あり）
- 状態: implemented（v1 `layers[].keyframes`・v2 `items[].keyframes` の両方で有効）

## 1. 意味論

- `keyframes[]` はレイヤー / アイテムの `transform` / `crop` / `perspective` を時間で動かす共通機構
- `t` は**ローカル時間**: v1 `layers[].keyframes[].t` はレイヤー内秒（`layerItem.t` を 0 とする。`cuts[].framing.keyframes[].t` と同じ規約）、
  v2 `items[].keyframes[].t` は**アイテム内の整数フレーム**（`item.at` を 0 とする）
- `transform` / `crop` / `perspective` はそれぞれ**独立の任意プロパティ**（プロパティごとの別トラックにはしない — 1 点で複数プロパティを同時に動かせる）
- ある区間の両端点が同じプロパティを持てばその間は**線形補間**。片方の端点にしか無ければ直近の宣言値を**保持（hold）**
- どの点にも一度も宣言されないプロパティは、レイヤー / アイテム直下の**静的値**（省略時は各 `$def` の既定値）を全区間で保持する
- `easing` は点ごとに設定し、**その点へ入る区間**（1 つ前の点からこの点まで）の補間カーブを決める。先頭点の `easing` は無視。省略時 `linear`。語彙は `linear` / `ease-in-out`
- 2 点以上・`t` 昇順・重複禁止（`validate-edit.mjs` で検証）。`keyframes` が無い、または使える点が 2 点未満のときは既存の静的値のみが効く（回帰なし・バイト等価）
- render-cut は cuts 合成後のベース映像へ `t` 順に合成する。プレビューは同じ補間を CSS / WebGL で再現する（`contract-2026-08-02-preview-parity.md`）

## 2. 参照元（復元時点）

`packages/schemas/edit.schema.json` / `packages/schemas/bin/validate-edit.mjs` / `packages/render-cut/src/layer-keyframes.mjs` / `packages/render-cut/src/layers.mjs` /
`packages/render-cut/test/layer-keyframes.test.mjs` / `packages/preview-server/test/layer-keyframes-visual.test.mjs` /
`apps/shell/extensions/akari-preview/src/common/edit-summary-fields.ts` / `apps/shell/extensions/akari-preview/src/common/layer-keyframes-visual.ts` /
`apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts` とそのテスト
