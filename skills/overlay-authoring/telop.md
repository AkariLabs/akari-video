# 字幕・テロップ設計

字幕は発話を読み取らせる反復 UI、テロップは要点や感情を強調する画面要素として分けて設計する。両者を同じ密度・同じ強さにしない。

## 原則

- `lang="ja"` を付け、日本語グリフを持つローカルフォントとフォールバックを指定する。書き出し環境に存在しないフォントへ暗黙依存しない。
- 意味のまとまりで改行する。助詞、句読点、括弧の片側だけを行頭・行末へ孤立させず、必要なら HTML に明示改行を置く。事前に行分割を確定した字幕断片は、行内の再折返しを CSS で禁止し（`white-space: nowrap`）、生成時の改行を唯一の改行にする。
- 全角・半角、英数字、記号の扱いを作品内で統一する。縦組みは横組みの CSS を回転しただけで済ませない。
- 字幕は映像内テキストや顔を避け、通常は下側、衝突時は上側または左右へ移す。テロップは視線誘導の対象へ寄せるが、被写体を覆うことを「強調」と取り違えない。
- 静的な不透明・半透明の地、縁取り、影のいずれかで背景から分離する。`filter: blur()` / `backdrop-filter` に頼らない。
- `--font-size`、`--line-height`、`--color`、`--background`、`--max-width`、`--safe-*` を調整点として公開する。既定値は `var(--name, fallback)` に置き、外側の `vars` を遮らない。
- セレクタと `@keyframes` 名を素材固有の接頭辞で閉じる。

## 可読サイズと文字量の目安

焼き込みテロップに全プラットフォーム共通の公式最小 px 値はない。したがって、根拠のない `px` 下限をハードルールにせず、`--font-size` を出力高に応じて決め、最終解像度と想定する最小端末で実読する。未実機の値は **要検証** と記す。

日本語字幕の構造チェックには、Netflix の日本語 Timed Text 仕様を適用条件付きで使える。同仕様は横字幕を **全角 13 文字/行まで**、**2 行まで**とし、半角文字を 0.5 文字として数える。これは Netflix 納品仕様であり、AKARI Video や他プラットフォームへ無条件に一般化しない。長い場合は文字を縮める前に要約・分割する。

AKARI Video の字幕既定は 1 行 20 全角字・句読点優先分割（オーナー裁定）。Netflix 13 字は納品仕様であり AKARI の既定ではない。

出典: [Netflix Japanese Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215767517-Japanese-Timed-Text-Style-Guide)

## 配置セーフゾーン

固定値を使う前に配信先、広告かオーガニックか、画角、CTA、字幕欄、LTR/RTL を確定する。同名プラットフォームでも条件が違えば数値を流用しない。

| 適用条件 | 公式数値 | 運用 |
|---|---:|---|
| YouTube 縦型**動画広告**、1080×1920 | 上 288px、右 192px、下 672px、左 48px を避ける | 重要文字・ロゴを残りの safe area 内へ置く。オーガニック Shorts の値として使わない |
| Instagram / Facebook **Reels 広告**、9:16 | 下 35% を空ける | 下側に重要文字・ロゴを置かず、Meta の safe-zone checker でも確認する |
| TikTok Auction In-Feed 広告 | 固定座標なし | 画角、caption 長、追加 format、LTR/RTL に対応する公式 ZIP と Preview を使う。値は **要検証** |

YouTube の safe zone も全端末保証ではない。オーガニック投稿や表にない配信先は、固定座標を書かず **要検証** とし、公開直前のプラットフォーム preview で確認する。

出典:

- [Google Ads Help — About video ad specs](https://support.google.com/google-ads/answer/13547298?hl=en)
- [Google — Universal Video Ad Safe Zones](https://services.google.com/fh/files/misc/universalsafezones-youtube.pdf)
- [Meta — The Reels ads guide](https://d3m889aznlr23d.cloudfront.net/img/events/458925814/assets/e042d2be.reels_ads_guide1.pdf)
- [TikTok Ads Manager — TikTok Auction In-Feed Ads](https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads)

## コーナーキャプション（TV 風の隅ラベル）

放送の左上・右上に常駐する番組名/コーナー名ラベル。番組タイトル + 現在の章タイトルを出し、章立てに追従させる定型。**素材ライブラリに入れず、この定型から都度生成してよい**（プロジェクト固有のテキスト差し替えが本体で、再利用価値は構造にしかないため）。

- **HTML/CSS で作る。画像生成にしない**: 章ごとのテキスト差し替えが必要で、画像だと章数分の生成と文字品質リスク（画像生成の日本語誤字）を抱える。HTML なら 1 断片 + 章ごとのオーバーレイエントリで済み、プレビューと書き出しが同一ソースを通る
- **章追従の実装**: 同じ断片を章数分コピーし、章タイトルのテキストと `data-start` / `data-duration` を章の区間に合わせる（1 章 = 1 オーバーレイエントリ）。テキストは**断片 DOM に直接置く**（CSS 変数でのテキスト保持は禁止。変更は html パッチ / contenteditable 経由）
- **構造の目安**: ルート 1 つ + プレート（番組名の行 + 章名の行、または 1 行連結）。位置は外側コンテナの transform（ランタイム所有）で決め、断片は見た目だけを持つ
- **常駐物の抑制**: 常時表示なので主張を抑える。小さめの `--font-size`、半透明の地、画面の隅で被写体・字幕・映像内 UI と重ねない。字幕（下側）と同時表示が前提なので、下側には置かない
- knobs の例: `--plate-bg`、`--accent`、`--font-size`、`--radius`。既定値は `var(--name, fallback)` で公開する
- 章替わりの出入りは短い opacity / translate のみ。保持中は動かさない（アニメーション節の原則どおり）

## アニメーション

- 字幕の出入りは短い opacity / translate を使い、保持中は動かさない。
- 1 文字ずつの出現は可読速度とシーク再現性を損ねやすい。必要な演出だけに限定し、文字 DOM は先に確定しておく。
- CSS animation / WAAPI を使い、ランタイムが `currentTime = (t - start) * 1000` を設定できる形にする。
- 位置移動の transform は断片内の子要素へ付け、AKARI が所有する外側コンテナの幾何 transform と分離する。

### IN/OUT を 1 本の `animation` に並べるときの fill-mode の罠（2026-08-04 実測）

`animation: X__in 0.6s both, X__out 0.6s 3.2s both` のように **OUT 側へ `both` を付けると IN が死ぬ**。
OUT の `both`（= backwards fill）は**遅延中に OUT の開始値（`opacity: 1` 等）を先に適用**し、
後に書かれたアニメーションが同一プロパティでは勝つため、遅延中ずっと IN の値を上書きする。
結果、フェード IN / スライド IN が出ないまま最初から表示済みになる。これは標準の CSS 挙動であり、
**プレビューでも焼き込みでも同じ結果になる**（プレビューのバグではない）。

- **OUT は `forwards` にする**（`animation: X__in 0.6s both, X__out 0.6s 3.2s forwards`）
- 単一アニメの断片（stagger / loop）では起きない。IN と OUT を 1 本のプロパティに並べたときだけ
- チェック: 断片の冒頭数フレームをシークし、IN の開始値（opacity 0 / 画面外）から始まることを目視する

## よくある間違い

- 文字が多いまま font-size だけを下げる。
- 日本語を画像生成モデルに描かせ、誤字や崩れを納品する。
- 字幕と強調テロップを常時同時表示して、どちらも読めなくする。
- 白文字だけを明るい映像へ直置きする。
- 非公式テンプレートの safe zone 数値を、別の placement やオーガニック投稿へ転用する。
- 断片ルートで `--font-size` などを再定義し、`edit.json.vars` の上書きを効かなくする。
