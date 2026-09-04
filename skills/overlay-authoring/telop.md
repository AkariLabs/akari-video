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
  日本語で時間差の出現をやるなら 1 文字ではなく**文節単位**にする（下の「テキスト分割と stagger 規約」）。
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
- この罠は IN/OUT の 2 段に限らず一般化できる（3 段以上の連鎖、点滅ループの片端省略など）。`motion.md`「複数アニメーションを同一プロパティへ連鎖させるときの暗黙 0% 上書き」を参照

## テキスト分割と stagger 規約（2026-08-15）

文字・単語・文節ごとに時間差で出す演出は、**断片が分割済みで出荷し、
stagger は CSS の `calc()` で表現する**。断片に `<script>` は書かない。

```html
<div class="foo__line" data-akari-split="bunsetsu"
  ><span class="akari-u" style="--i:0">今日は</span
  ><span class="akari-u" style="--i:1">とても</span
  ><span class="akari-u" style="--i:2">いい</span
  ><span class="akari-u" style="--i:3">天気ですね</span></div>
```

```css
.foo__line{
  --anim-duration: var(--anim-duration-telop, 500ms);  /* 1 要素の尺（対象別の相場は motion.md） */
  --anim-stagger:  150ms;                              /* ずらし */
  --anim-easing:   var(--ease-snap-out);               /* 語彙は motion.md「イージング語彙」。未指定なら smooth */
}
/* ★ [data-akari-active] ゲートの中で宣言する（下の「性能」参照） */
[data-akari-active] .foo__line .akari-u{
  animation: foo__in var(--anim-duration) var(--anim-easing) both paused;
  animation-delay: calc(var(--i) * var(--anim-stagger));
}
@keyframes foo__in{
  from{ opacity:0; transform: translateY(var(--anim-distance, 50px)); }
  to  { opacity:1; transform: none; }
}
```

- **`animation-delay: calc(var(--i) * var(--anim-stagger))` の 1 行がすべて**。
  どの `@keyframes`（= どの演出）にも同じ形で stagger が掛かる。
  演出ごとに遅延を書き並べない
- **ツマミは CSS 変数**にする。`edit.json` の `vars` から上書きできる
- **`--i` は 0 始まりの通し番号**。`--n` に総数が入る（ランタイムが振る）

### 分割単位（`data-akari-split`）

| 値 | 単位 | 使いどころ |
|---|---|---|
| `bunsetsu` | 文節（日本語の表示単位） | **日本語テロップの既定** |
| `chars` | 1 文字 | 演出用。可読速度を損ねるので多用しない |
| `words` | 単語 | 欧文向け。**日本語では分かち書きしないので機能しない** |
| `lines` | 行 | 行単位で送る |
| `none` | 分割しない | — |

日本語の文節分割は BudouX（`src/vendor/budoux-ja-bundle.js`・Apache-2.0）で行う。
`Intl.Segmenter` 単体の単語分割は助詞がバラけるため使わない
（`今日 | は | とても | いい | 天気 | です | ね` になる）。

### ランタイムの担当（断片は書かなくてよい）

`data-mirror="text"` と同じく、DOM 操作はランタイムが持つ:

- **mount 時**: 宣言はあるが未分割の要素を分割する（出荷漏れの安全網・冪等）
- **編集開始時**: 分割を素のテキストへ畳む（`<span>` のまま contenteditable にすると
  打鍵で span が割れる・キャレットが単位境界で飛ぶ）
- **編集確定時**: 確定したテキストで分割し直し、`--i` を振り直す。
  保存される HTML は**分割済みの状態**（書き出しは断片の HTML をそのまま使うため）

必要ランタイム: **0.5.0 以降**。素材の `meta.json` に
`min_overlay_runtime_version: "0.5.0"` を宣言する。

### 性能 — `[data-akari-active]` ゲートは必須（実測）

分割は 1 断片の CSS animation を分割数ぶんに増やす。ゲートが無いと即死する:

| 条件 | 現存 animation | 1 tick |
|---|---:|---:|
| ゲート有り・1,200 断片 × 16 分割・可視 60 | 960 | **0.023ms** |
| ゲート無し・1,200 断片 × 8 分割 | 9,600 | **221ms** |
| ゲート無し・上記 + 可視 60 | 9,600 | **11,783ms** |

`getAnimations()` のコストは「ドキュメント全体に現存する CSS animation の総数」に
比例する。ゲートの中で宣言すれば非可視分は現存しないので、**分割そのものは無害**。
ゲートを忘れた断片が 1 つあるだけで全体が落ちる。

## 多層テキスト断片と data-mirror 規約（2026-08-06）

同一テキストを太さ違いの `-webkit-text-stroke` 等で複数層重ねる断片（多重縁取り・ずらし影・裏打ち・二段押し出し等）は、編集対象を 1 層に決めないと打ち替えが層間でズレる。層間の同期は overlay-runtime（`packages/overlay-runtime/`）側の機能で行う。

- **複製層に印を付ける**: 縁取り・影・裏打ち等でテキストを複製した層は `data-mirror="text"` を持たせる。編集対象（ダブルクリック → contenteditable）は最前面の fill 層 1 箇所だけにする。断片側に `contenteditable` や特別な役割属性を明示する必要はなく、「`data-mirror="text"` を持たない直接テキスト層」という消去法で決まる（runtime の `canEditText` がミラー層を候補から除外する）
- **構造の作法**: ミラー層と fill 層は同じ積層コンテナ（例 `.stack`）の直下に置く。同期スコープは既定で編集層の親要素配下を対象にするため、離れた場所に置くと同期されない
- **同期は runtime が行う**: 編集層の `input` / `compositionend` で textContent を同一 stack 内の全 `data-mirror="text"` 層へコピーする。断片側に `<script>` を書く必要はない（FORBIDDEN 級ルール「トップレベルを複数にしない」とも整合）。保存確定時にも同期の安全網が働く
- **出荷時の状態**: 断片は全層に同一テキストを焼き込んで出荷する。ミラー未対応の runtime でも初期表示は正しい — ライブ編集の層間同期だけが `packages/overlay-runtime/package.json` の `version` `0.2.0` 以降（`window.akari.runtime.version` で参照可）に依存する。素材の `meta.json` にはトップレベル任意フィールド **`min_overlay_runtime_version`**（x.y.z・asset-meta.schema.json に 2026-08-06 新設）で最低対応バージョンを宣言する
- **アクセシビリティ**: mount 時にランタイムが全ミラー層へ `aria-hidden="true"` を付与する。断片側で書く必要はない

## 中央寄せの可用幅の罠 — 折返し可能な内容全般（2026-08-06 実測・同日一般化）

`position: absolute; left: 50%; transform: translateX(-50%)` で中央寄せした要素では、
shrink-to-fit の可用幅計算が transform を無視して「left 位置からステージ右端まで」
（= ステージ幅の半分）を可用幅と誤認する。当初 flex-wrap 併用時の事故として実測したが
（1920px ステージで 960px と誤認し**既定文言でも勝手に折り返る**）、flex を使わない
単一 stack 構造でも**折返し可能な内容なら同じ機序で発現する**（小さいキャンバスで顕在化
しやすい — 検証スクショを 600px 級の狭い舞台で撮ると本番で出ない折返しが出る）。
中央寄せ + 折返し許可の断片は、コンテンツ側に `width: max-content` を与えて
shrink-to-fit を回避する（折返しさせたい場合だけ明示の `max-width` を併記する）。
検証スクショは実プロダクション幅（1080px 以上）でレンダリングしてからトリムする。

## よくある間違い

- 文字が多いまま font-size だけを下げる。
- 日本語を画像生成モデルに描かせ、誤字や崩れを納品する。
- 字幕と強調テロップを常時同時表示して、どちらも読めなくする。
- 白文字だけを明るい映像へ直置きする。
- 非公式テンプレートの safe zone 数値を、別の placement やオーガニック投稿へ転用する。
- 断片ルートで `--font-size` などを再定義し、`edit.json.vars` の上書きを効かなくする。

## 固定ラベルの帯分離（2026-08-03 実測 2 敗からの規則）

サンプル表示・タイプ入力欄など**可変コンテンツと、カウンタ・注記・ボタンなどの固定ラベルを、
同じラッパーの中に絶対配置で同居させない**。実測した事故が 2 型ある:

1. **ラッパー基準の bottom 逸脱**: 中央寄せラッパー（例 1400×420）内の `bottom: 60px` は
   「画面の下」ではなく「ラッパーの下」= 画面中央帯になり、中のサンプル文字と重なる。
   固定ラベルは**ステージ（断片ルート）直下**に絶対配置し、コンテンツ領域と帯を分離する
2. **可変長コンテンツの帯侵入**: 入力欄の右端にボタンを絶対配置すると、タイプされる文字列が
   伸びてボタン帯へ潜り込む。ボタン帯ぶんの `padding-right` を親に確保して幅を先取りする

チェック: 断片を書いたら「いちばん長い状態のコンテンツ」を入れたフレームで、固定ラベルとの
重なりを目視する（最長文字列・最終タイプ状態・最多行）。
