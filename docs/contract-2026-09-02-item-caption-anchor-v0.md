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

render-cut / gpu / osr / shell preview / preview-server の各出口は、captions.json を
`toAnchorCaptions` で正規化して `readInternalEdit` の `options.captions` へ渡し、読込時にアンカーを
再解決する。captions.json が無い場合は従来どおり `at` / `duration` のキャッシュを読む。

字幕の時刻・参照集合を変える `setCaptionTiming` / `shiftCaption` / `insertCaption` /
`removeCaption` は、captions.json の書き込み後に `refreshItemAnchors` でキャッシュを更新する。
`writeEditSnapshot` と preview-server の captions PUT は呼び出し側が再解決の責務を持つ。
captions.json と edit.json の 2 ファイル間に原子性はなく、途中で停止してキャッシュが古くなった場合は
lint `v2.item-anchor-stale` が検出する。

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
- `itemAtV2` の string 拡張
- 単語 index アンカー
- `captions` / `caption` item へのアンカー
- 解決不能 item への `hidden` 自動付与
