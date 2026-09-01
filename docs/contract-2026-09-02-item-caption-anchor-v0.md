---
lifecycle: accepted
created: 2026-09-02
updated: 2026-09-02
---

# edit.json v2 アイテム行アンカー契約 v0

## 0. 位置づけ

本契約は、時間の従属 3 分類のうち ②「字幕行に従属するアイテム」を定める。対象は
`media` / `html` / `telop` / `filter` / `group` の visual item である。字幕行全体または行内の
単語相当区間を source 秒で参照し、字幕時刻の変更後に同じ純関数でアイテム時刻を再導出する。

`captions.json.emphasis_words[]` も source 秒の実測区間を持つが、そちらは語の演出宣言である。
本契約の `anchor` は edit.json のアイテム配置を字幕へ従属させるための参照であり、語の index や
文字列を正本にしない。

## 1. データ模型

```jsonc
{
  "id": "broll-2",
  "at": 90,
  "duration": 24,
  "anchor": {
    "caption": "c-0002",
    "range": { "start": 3.1, "end": 3.9 },
    "offset": -2,
    "duration": "caption"
  },
  "source": { "kind": "html", "path": "overlays/box.html" }
}
```

- `caption` は `captions.json` の行 id（`^c-\d{4}$`）で、必須。
- `range` は任意の `{ start, end }`。字幕行の `[start, end]` 内にある source 秒の半開区間で、
  `start < end` とする。省略時は字幕行全体を使う。
- `offset` は任意の整数フレーム。負数も許す。
- `duration` は `caption` または `own`。省略時は `caption`。
- `at` / `duration` は従来どおり必須の整数フレームだが、`anchor` があるときは解決結果の
  キャッシュである。正本は `anchor` と参照字幕である。
- 最上位 item の `at` は出力絶対フレーム。子 item の `at` は従来どおり親相対で、アンカーも
  出力絶対位置を解いた後に親の絶対 `at` を引いて保存する。

## 2. 解決規則

`sourceToOutput(segments, sourceT)` は、source 秒が保持された `src` segment 内なら
`outStart + (sourceT - srcStart) / speed` を返す。カット内なら次の保持 segment の
`outStart` へスナップし、素材末尾を超えた値は最終 segment の `outEnd` へクランプする。
`time_domain: "output"` の字幕は写像せず、その秒値を出力秒として使う。

`start_src = anchor.range?.start ?? caption.start`、
`end_src = anchor.range?.end ?? caption.end` とし、両端を出力秒へ写す。

```text
at = round(start_out * fps) + (offset ?? 0) - parentAtFrames
duration(caption) = max(1, round(end_out * fps) - round(start_out * fps))
duration(own) = item.duration
```

`at < 0` はクランプせず、既存の親区間 lint に委ねる。両端が同じ出力時刻になる場合は区間全体が
カット内なので unresolvable とし、キャッシュを変えない。参照字幕が無い場合も同様にキャッシュを
保つ。どちらの場合も `hidden` を自動付与しない。

## 3. 解決の入口と出口

共通入口は `readInternalEdit(source, { captions })` である。`captions` が渡されたときだけ
`resolveItemAnchors` を通してから内部モデルを構築する。渡されない場合は `at` / `duration` の
キャッシュを従来どおり読み、アンカー導入前の挙動を変えない。

本契約では render-cut / gpu / osr / shell preview / preview-server の呼び出しへ
`options.captions` を配線しない。各出口はキャッシュを読むだけで同じ時刻を見る。字幕を書き換える側が
保存前にアンカーを再解決する責務を持ち、この自動配線は T7b で行う。

## 4. mutation

- `setItemAnchor(edit, id, anchor, captions)`: anchor を書き、直ちに解決してキャッシュも更新する。
  解決不能は throw せず warning とキャッシュ保持で返す。
- `clearItemAnchor(edit, id)`: anchor だけを削除する。現在の `at` / `duration` は焼き込みとして残す。
- `refreshItemAnchors(edit, captions)`: 全 item を親から子の深さ優先で再解決する
  `resolveItemAnchors` の薄い wrapper。

## 5. lint

| check | severity | 条件 |
|---|---|---|
| `v2.item-anchor-ref` | error（captions.json 不在時 warning） | `anchor.caption` の参照先が無い |
| `v2.item-anchor-range` | error | range が字幕区間外、または `end <= start` |
| `v2.item-anchor-kind` | error | `captions` / `caption` item が anchor を持つ |
| `v2.item-anchor-stale` | warning | 解決値とキャッシュの `at` / `duration` が違う |
| `v2.item-anchor-unresolvable` | warning | アンカー区間全体がカット内で出力尺を持たない |

## 6. 非スコープ

- 台本パネルの単語範囲ドラッグ、🎬 ボタンその他の UI
- annotations の RPC / mutation wrapper
- 出口側への `options.captions` 配線と字幕保存時の自動再解決
- `itemAtV2` の string 拡張
- 単語 index アンカー
- `captions` / `caption` item へのアンカー
- 解決不能 item への `hidden` 自動付与
