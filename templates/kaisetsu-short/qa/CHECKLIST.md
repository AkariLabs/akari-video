# QA チェックリスト（解説ショート・kaisetsu-short 正本）

原型実制作（v1〜v3）の検収で獲得した全チェック項目を機械実行可能な
形にまとめたもの。`tools/qa-capture.mjs` の出力（スクショ）を目視で本リストに沿って確認する。

## 使い方

```
node tools/qa-capture.mjs <projectDir> [--safezone] [--times t1,t2,...]
```

- 代表時刻は省略時 `timeline.json` から自動選定される（各ビートの序盤/中盤/終盤 + 揺れ
  最大振幅近傍。`autoSelectTimes()` 参照）
- `--safezone` を付けると `#safe-zone-guide` を重畳した版も撮れる（下記「4. セーフゾーン」
  はこのモードで確認する）
- 出力は `<projectDir>/<outDir>/qa/t<秒>-<scene>[-sz].png`

以下の 8 項目すべてについて、代表時刻のスクショを目視確認すること。

## 1. 口可視性

字幕プレート（title/ending）・吹き出し（diagram）がアバターの口を隠していないか。

- 確認対象: `#caption-plate` / `#bubble` とアバターの重なり
- 合格基準: どの代表時刻でも、口（`avatar-img` の口パーツ）がプレート/吹き出しの背後に
  隠れていない
- 既知の経緯: v3 で TITLE_BOX の height を 750→960 に修正して口を露出させた実績あり
  （`composition/index.html` の TITLE_BOX コメント参照）。レイアウトプロファイルを変更した
  場合は必ず再確認する

## 2. 見切れ（クリップ）

全シーンで、気持ち揺れ微動（±1.5deg 回転・上下 6px）の最大振幅時にもアバターの手足が
`#avatar-box` の `overflow:hidden` で欠けないか。

- 確認対象: 揺れ周期は回転 4.8s・上下 3.7s。代表時刻に `beat.start + 1.2s` 付近を含めて
  自動選定される
- 合格基準: 全身表示（ending）・胸上表示（title/diagram）ともに、手や肩が box の外へ
  はみ出してクリップされていない
- レイアウトプロファイル変更時は `TITLE_SIDE_MARGIN` / `DIAGRAM_SIDE_MARGIN` /
  `ENDING_SWAY_MARGIN_TOTAL` が sway 幅（`H * sin(1.5deg)`）以上の余白を確保しているか
  併せて確認する

## 3. 余白（カード化）

図解カード内のスクショ画像が、パディング・角丸・影のない「窮屈な生 B ロール」化して
いないか。

- 確認対象: `.shot-card`（`padding:28px`・`border-radius:20px`・`box-shadow` 付き）
- 合格基準: どの shot-card もカードとして額装されて見える（画像がカード枠いっぱいに
  張り付いていない）

## 4. セーフゾーン

重要要素（タイトル・図解カード・字幕プレート）が `layout.safeZone` の内側に収まっているか
（プラットフォームの縦長動画クロップ対策）。

- 確認方法: `--safezone` 付きでキャプチャし、`#safe-zone-guide` の点線内に主要素が入って
  いるか目視確認
- 合格基準: アバターがセーフゾーンの外（画面端）にはみ出すのは、diagram シーンの
  アバターのみ許容される明示的な例外（画面隅にタッチする設計、v3 由来）。それ以外の
  要素はセーフゾーン内に収める

## 5. 吹き出し形状

`#bubble` のしっぽが二重三角形パターン（枠色の大三角形 + 面色の小三角形）を維持しているか。

- 確認対象: `#bubble::after`（枠色三角形）+ `.tail-fill`（面色三角形、実要素・z-index 1）
- 合格基準: 縫い目が1本の輪郭に見える（面色三角形が枠色三角形の下に隠れて見えなくなる
  z-index バグが再発していない）

## 6. 縦長充填（空白帯禁止）

図解カードの縦長スペースに、コンテンツ不足による不自然な空白帯が生じていないか。

- 確認対象: 各 diagram ビートの `.dg-stack` 内、特に `collapseWhenHidden` 対象ブロック
  （mini-timeline・vs-card・cond-row・bullet-row 等）
- 合格基準: 未表示ブロックが `display:none` で確実にレイアウトから外れており、表示中の
  ブロックだけで自然に充填されている

## 7. 段階表示破綻

未表示要素が空白を予約していないか・crossfade 中間状態で不自然な表示にならないか。

- 確認対象: `collapseWhenHidden: true` のブロック（display none/flex 切替）と
  `collapseWhenHidden` 無しのブロック（visibility hidden/visible・レイアウト位置は保持）
  の使い分けが意図通りか
- グループ crossfade（b2 型パターン: `diagram.groups` + `diagram.crossfade`）の中間フレーム
  で、両グループが不自然に重なって読めなくなっていないか
- preRevealOpacity（0.14 の「予告表示」等）が意図通り機能しているか（完全に消えず・
  完全に主張しすぎない中間の目立たなさになっているか）

## 8. SNS グリフ

ending シーンの SNS ブロックが、実 SVG アイコン + ハンドル表記になっているか。

- 確認対象: `#sns-row` の `.sns-badge svg`（`channel.json` の `sns[].icon` から解決）と
  `.sns-caption`（`sns[].caption`）
- 合格基準: プレースホルダ文字列やアイコン欠落（alt テキストの空枠）がなく、
  `channel.json` で定義した分だけ正しい順序で並んでいる

---

## 機械チェックとの対応

| # | 項目 | qa-capture.mjs での確認方法 |
|---|---|---|
| 1 | 口可視性 | 通常キャプチャ（`--safezone` 無し）を目視 |
| 2 | 見切れ | 通常キャプチャ。`beat.start+1.2s` 系の時刻を含める |
| 3 | 余白 | 通常キャプチャを目視 |
| 4 | セーフゾーン | `--safezone` 付きキャプチャ |
| 5 | 吹き出し形状 | diagram シーンの通常キャプチャを拡大確認 |
| 6 | 縦長充填 | 各ビート中盤〜終盤の通常キャプチャ |
| 7 | 段階表示破綻 | 自動選定時刻（序盤/中盤/終盤）を横断して比較 |
| 8 | SNS グリフ | ending シーンの通常キャプチャ |

テンプレ抽出時の golden 検証では、原型動画とのスポットフレーム並置ピクセル比較で
1〜8 全項目が退行していないことを数値的にも確認済み（記録は内部リポ）。
