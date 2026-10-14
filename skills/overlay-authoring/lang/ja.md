# Japanese content conventions

## telop.md — 原則

- `lang="ja"` を付け、日本語グリフを持つローカルフォントとフォールバックを指定する。
- 意味のまとまりで改行する。助詞、句読点、括弧の片側だけを行頭・行末へ孤立させず、必要なら HTML に明示改行を置く。
- 全角・半角、英数字、記号の扱いを作品内で統一する。縦組みは横組みの CSS を回転しただけで済ませない。

## telop.md — 可読サイズと文字量の目安

日本語字幕の構造チェックには、Netflix の日本語 Timed Text 仕様を適用条件付きで使える。同仕様は横字幕を **全角 13 文字/行まで**、**2 行まで**とし、半角文字を 0.5 文字として数える。これは Netflix 納品仕様であり、AKARI Video や他プラットフォームへ無条件に一般化しない。長い場合は文字を縮める前に要約・分割する。

AKARI Video の字幕既定は 1 行 20 全角字・句読点優先分割（オーナー裁定）。Netflix 13 字は納品仕様であり AKARI の既定ではない。

出典: [Netflix Japanese Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215767517-Japanese-Timed-Text-Style-Guide)

## telop.md — コーナーキャプション（TV 風の隅ラベル）

画像だと章数分の生成と文字品質リスク（画像生成の日本語誤字）を抱える。

## telop.md — アニメーション

日本語で時間差の出現をやるなら 1 文字ではなく**文節単位**にする（下の「テキスト分割と stagger 規約」）。

## telop.md — テキスト分割と stagger 規約（2026-08-15）／分割単位（`data-akari-split`）

| 値 | 単位 | 使いどころ |
|---|---|---|
| `bunsetsu` | 文節（日本語の表示単位） | **日本語テロップの既定** |
| `words` | 単語 | 欧文向け。**日本語では分かち書きしないので機能しない** |

日本語の文節分割は BudouX（`src/vendor/budoux-ja-bundle.js`・Apache-2.0）で行う。
`Intl.Segmenter` 単体の単語分割は助詞がバラけるため使わない
（`今日 | は | とても | いい | 天気 | です | ね` になる）。

## telop.md — よくある間違い

- 日本語を画像生成モデルに描かせ、誤字や崩れを納品する。

## thumbnail.md — 文字強調

日本語の最終文字は HTML で組む。画像生成モデルへ見出し、ロゴ、UI の正確な描画を任せない。

## thumbnail.md — 経路 A — 実フレーム + HTML 文字組

- 日本語、数字、ロゴ、UI を正確に見せる必要がある。

## thumbnail.md — 混成 — B の背景 + A の文字

独自背景は必要だが、日本語、ブランド、数値は正確に保つ場合に選ぶ。B では文字・ロゴ・UI を入れず余白を指定し、A の HTML layer で最終文字と正式 asset を置く。

## thumbnail.md — `examples/` の HTML → スクショ手順

3. 文字、色、crop、accent を CSS 変数化する。日本語は HTML text として置く。

## thumbnail.md — よくある間違い

- 日本語やロゴを画像生成モデルに描かせる。
