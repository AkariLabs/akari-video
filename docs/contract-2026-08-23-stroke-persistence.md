---
lifecycle: implemented
created: 2026-08-23
updated: 2026-08-23
---

# 注釈ストローク永続表示契約

- 日付: 2026-08-23
- 状態: **実装済み**
- 前提: `contract-2026-08-11-review-session-ui-events.md`、
  `contract-2026-07-20-review-json-v1-annotation-model.md`
- スコープ: Theia shell の出力プレビュー、review session の `strokes.json` 読み出し、
  compile-review-session と address-review の追跡導線

## 1. セッション中の表示

- pen / rect は従来どおり正規化座標（プレビューフレーム左上を `(0, 0)`、右下を `(1, 1)`）で
  記録する。表示時に現在の content rect へ写像し直すため、ウィンドウのリサイズと出力比率の
  変更で座標は変わらない。
- pointerup 後は従来のグロー・きらめき・600 ms フェードをそのまま再生し、その後段の静的
  ビットマップへ同じ正規化図形を残す。新しい録音セッションの開始時に前セッションの表示を
  クリアし、録音終了では消さない。
- 描線 canvas は非描画モードで `pointer-events: none` とする。ペンまたは四角モードのドラッグ中
  だけ既存どおり入力面になる。
- 注釈パネルの「描線を表示」チェックは既定 ON。OFF は残留描線と明示的に再表示した描線を隠し、
  データを削除しない。ON に戻すと保持した正規化座標から即時再描画する。

## 2. 既存セッションの読み出しと再表示

`readReviewSessionStrokes({projectRootUri, sessionId})` は
`review/sessions/<sessionId>/strokes.json` を読み、次を返す。

```jsonc
{
  "sessionId": "s-0001",
  "strokes": [/* pen / rect。frame と recTStart/recTEnd を保持 */],
  "warnings": []
}
```

- `strokes.json` 欠落は `strokes: []` として正常終了する。
- 配列ルート、または `version: 1` でない `{strokes:[]}` は旧形式として寛容に読む。
- JSON 破損、未知要素、値域外要素は描線単位で除外して warning に残す。セッション一覧と他の
  描線を巻き込んで失敗させない。
- 注釈パネルの各録音済みセッションにある「描線」から再表示できる。表示メッセージには
  `target.tab`（edit URI）と先頭ストロークの `target.recT` を添え、`frame.sourceT/cutIndex` で
  プレビューを同じフレームへシークする。

## 3. compile 後の原本参照

review.json の data `version` は 0 のまま据え置く。compile-review-session はペアになった pen / rect
へ、既存フィールドを変えず次の任意フィールドを追加する。

```jsonc
"strokeRefs": [{
  "sessionId": "s-0001",
  "strokeId": "st-0001",
  "sessionRef": "s-0001/st-0001"
}]
```

- `strokeRefs` は `null`、省略、または 1 件以上の配列。欠落は従来データとして正常である。
- pen は従来どおり最大 100 点の `strokes[].points` も埋め込み、`strokeRefs` から無加工の原本へ
  戻れる。rect は従来どおり `targetKind:"region"` + `region.box` を埋め込み、同じ `strokeRefs`
  から `strokes.json` 内の rect 原本へ戻れる。
- address-review の一覧は `strokeRefs` を
  `review/sessions/<sessionId>/strokes.json#<strokeId>` として表示する。

## 4. 互換性

- 追加フィールドのみを使い、既存フィールドの削除・意味変更・data version bump は行わない。
- 読み手は未知フィールドを保持し、任意フィールドの欠落を旧データとして扱い、既知より大きい
  data version を推測変換しない。
- `packages/preview-server` は本契約の対象外であり、WebUI の表示挙動は変更しない。
