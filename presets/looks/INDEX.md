# ルックプリセット

コードが id から presets/looks/<id>.json を読む参照表。adjustV1 に適合する basic / wheels の初期値セットです。適用時は basic と wheels を丸ごと置換し、lut / curves / hue は保持します。インスペクターの配線は M2-3 便です。

旧 src/lib/color-grade-presets.ts の 8 種から移植。vignette は空間処理のため除外しています。適用後も個別に調整できます。

| id | 名前 | 説明 |
|---|---|---|
| [teal_orange](./teal_orange.json) | ティール＆オレンジ | 映画的 補色コントラスト |
| [golden_hour](./golden_hour.json) | ゴールデンアワー | 黄金時間帯の温かみ |
| [filmic_fade](./filmic_fade.json) | フィルミックフェード | フィルム質感のフェード |
| [clean_punch](./clean_punch.json) | クリーンパンチ | シャープなコントラスト |
| [bleach](./bleach.json) | ブリーチバイパス | 漂白バイパス・高コントラスト低彩度 |
| [noir_soft](./noir_soft.json) | ソフトノワール | ソフトモノクロ |
| [cool_matte](./cool_matte.json) | クールマット | クールなマット |
| [vivid_summer](./vivid_summer.json) | ビビッドサマー | 彩度高め・夏らしい |
