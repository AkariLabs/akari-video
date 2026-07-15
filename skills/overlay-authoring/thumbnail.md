# サムネイル設計

サムネイルは静止画として **1280×720** で出力する。候補は複数作り、タイトル文字の差分も見せて編集判断レポートの先頭へ置く。候補数の一律閾値は契約にないため、依頼と比較したい仮説から決め、根拠のない「標準個数」を発明しない。

## 状況から型を選ぶ

| 状況・ジャンル | 第一候補の型 | 注意点 |
|---|---|---|
| 操作解説・ソフトウェア | UI の証拠フレーム + 注目箇所 + 結果を示す短い見出し | UI 全景を縮小せず、見せたい部分を crop する |
| 商品・機能発表 | product hero + ベネフィット + 小さな category tag | ロゴ、形状、UI を生成で変形しない |
| 対談・人物解説 | 表情の読める人物 + 論点または対立軸 | 顔を過度に加工せず、視線の先に文字余白を作る |
| 比較・レビュー | split / versus + 比較対象 + 判断語 | 左右の縮尺と条件をそろえ、勝敗を捏造しない |
| before / after | 同条件の二面比較 + 変化点 | 撮影条件が違う素材を同一条件のように見せない |
| リスト・まとめ | 主役 1 点 + 数やカテゴリを示す badge | 小要素を並べすぎず、本文の一覧と混同しない |
| 事件・ストーリー・ドキュメンタリー | key object / place + 緊張を作る短い問い | 本文にない断定や偽の出来事を描かない |

型はジャンル名だけで決めず、「何がクリック後に証明されるか」を基準にする。サムネイル単独で成立し、動画内容と約束が一致するものだけ採用する。

## デザイン語彙

### 背景処理

| 技法名 | 用途 | HTML/CSS 実装ヒント |
|---|---|---|
| crop / focal crop | 主役を大きく見せる | `<img>` の `object-fit: cover` と `object-position` を変数化する |
| gradient wash | 文字側のコントラストを作る | 疑似要素の linear / radial gradient を使う |
| vignette | 周辺を落として中央へ集める | 疑似要素の radial-gradient。CSS blur は使わない |
| duotone / color wash | シリーズ感を統一する | 半透明の blend layer を重ね、元の証拠を潰さない |
| cutout silhouette | 人物・商品を背景から分離する | 事前生成した alpha PNG / HEVC を使い、輪郭を検品する |
| split field | 比較対象を一目で分ける | Grid の 2 region と境界線を使う |

背景ぼかしが必要なら、静止画像を事前処理する。動画 overlay の禁止事項である `filter: blur()` / `backdrop-filter` をデザインの前提にしない。

### FX

| 技法名 | 用途 | HTML/CSS 実装ヒント |
|---|---|---|
| outline / keyline | 主役の輪郭分離 | alpha cutout の背面へ複製 silhouette をずらして置く |
| halftone | 情報・コミック感 | radial-gradient の pattern layer |
| speed lines | 勢い・方向 | repeating-conic / repeating-linear gradient |
| accent ray | 注目点から放射 | conic-gradient を mask して不透明度を抑える |
| hard offset shadow | 奥行き・ポップ感 | blur の小さい box/text shadow または複製 layer の translate |
| sticker / tape | 補助ラベル | transform した小さな tag。本文より強くしない |

### 文字強調

| 技法名 | 用途 | HTML/CSS 実装ヒント |
|---|---|---|
| stroke | 背景から分離 | `-webkit-text-stroke` と通常色を併用する |
| highlight band | キーワードだけ強調 | inline span の背景色と padding |
| two-tone keyword | 意味の対比 | キーワード span の `--accent` を差し替える |
| condensed stack | 短い見出しを大きく積む | 明示改行と line-height。自動折返し任せにしない |
| label + headline | 種別と主張を分離 | 小 tag と大見出しを別 hierarchy にする |
| hard shadow | 小サイズでも輪郭を残す | 複製文字を `aria-hidden` で背面へ offset する |

日本語の最終文字は HTML で組む。画像生成モデルへ見出し、ロゴ、UI の正確な描画を任せない。

## 経路を選ぶ

### 経路 A — 実フレーム + HTML 文字組

次の場合に選ぶ。

- 動画内に顔、商品、UI、結果などの強い証拠フレームがある。
- 日本語、数字、ロゴ、UI を正確に見せる必要がある。
- 生成による事実改変を避ける必要がある。

実フレームを crop / grade し、文字、badge、矢印、比較線だけを HTML/CSS で重ねる。

### 経路 B — Codex 画像生成

次の場合に選ぶ。

- 使用可能な実フレームがない。
- 抽象概念、世界観、イラストが主役で、写真の証拠性を要求しない。
- 生成物であることと provenance を記録できる。

文字なしの構図を生成し、生成手、prompt、日時を記録する。API key の直叩きへ fallback しない。画像生成が使えなければ A または制作保留に戻す。

> **実測済み（2026-07-14）**: `codex exec --skip-git-repo-check` 経由で 16:9・文字なしの背景 PNG（1664×936、1.7MB）が約 93 秒で実ファイル出力されることを視認確認済み。呼び出し形・事前確認・既知の失敗モード（アカウント使用量上限）は [edit-plan/approvals-and-generation.md](../edit-plan/approvals-and-generation.md) の「手 1（Codex 画像生成）の実働確認」を参照。

### 混成 — B の背景 + A の文字

独自背景は必要だが、日本語、ブランド、数値は正確に保つ場合に選ぶ。B では文字・ロゴ・UI を入れず余白を指定し、A の HTML layer で最終文字と正式 asset を置く。

## `examples/` の HTML → スクショ手順

現在はサムネ専用 CLI がないため、既存 `scripts/render-overlays.mjs` の static Chrome と同じ方式を使う。`render-overlays.mjs` 自体は manifest 必須の overlay renderer であり、サムネ用 CLI として直接呼ばない。

1. `examples/local/thumbnails/<slug>/index.html` を作る。`examples/local/` は gitignore 対象の試作場所である。
2. `html, body` と単一 sheet を 1280×720、margin 0、overflow hidden にする。背景を明示し、画像・font は同ディレクトリ以下のローカル相対 URL にする。
3. 文字、色、crop、accent を CSS 変数化する。日本語は HTML text として置く。
4. font と画像が load 済みになる構造にし、headless Chrome の virtual time 内で安定するようにする。
5. 次の実装済み flags で単発 PNG を撮る。

```sh
CHROME="${AKARI_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
test -x "$CHROME"
"$CHROME" --headless \
  --allow-file-access-from-files \
  --disable-background-networking \
  --force-device-scale-factor=1 \
  --hide-scrollbars \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1280,720 \
  --virtual-time-budget=10000 \
  --run-all-compositor-stages-before-draw \
  --screenshot="$PWD/examples/local/thumbnails/<slug>/thumbnail.png" \
  "file://$PWD/examples/local/thumbnails/<slug>/index.html"
```

6. `sips -g pixelWidth -g pixelHeight .../thumbnail.png` で **1280×720** を確認する。
7. PNG を実見し、文字欠け、font fallback、crop、コントラスト、誤字、safe zone を確認する。採用 PNG は gitignore 外の案件成果物へ移す。

YouTube 広告向けの公式 thumbnail 推奨値も 1280×720、16:9 であるが、このスキルではユーザー指定の AKARI 出力契約として 1280×720 を固定する。出典: [Google Ads Help — About video ad specs](https://support.google.com/google-ads/answer/13547298?hl=en)

## よくある間違い

- 本文にない結果、感情、人物、UI を生成して事実のように見せる。
- 日本語やロゴを画像生成モデルに描かせる。
- 背景、人物、文字、矢印、badge をすべて同じ強さにする。
- 実フレーム全景を縮小して、小さな UI を読ませようとする。
- 16:9 sheet を CSS transform で拡縮し、最終 PNG の実寸を確認しない。
- network font / CDN 画像へ依存し、headless で欠落する。
- `examples/local` の試作 PNG を最終成果物の保存先と思い込む。
