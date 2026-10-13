# 字幕の見た目 v1 — 保存・換算・範囲・時刻・検証

- 日付: 2026-10-12
- 状態: v1

## 移行と書き出し

移行は render-cut の書き出し結果（HTML と CSS 変数）を保つ。移行済みの強調範囲は、描画時に `migrated_emphasis` に保存した元の項目と移行前の配列内の位置から `emphasis_words` へ戻す。残った項目の順を保ち、移した項目を位置の昇順に差し込む。追加のプロパティと項目の順序も保つ。旧形式だけの入力はそのまま描画器へ渡す。

| `style_hint`（省略時の `emotion`） | `motion.in.id` |
|---|---|
| `one-char-bang`（`pain`、`surprise`、`anger`） | `pop` |
| `one-char-jumble`（`disgust`） | `jitter` |
| `size-pulse`（`joy`、`emphasis`） | `zoom-pulse` |

この対応に無い hint、別の hint と同じ motion になるもの、項目ごとの `style_preset` を持つもの、語が行の表示文字列に一意に現れないもの、時刻が行の外に出るものは `emphasis_words` に残し、通知と未解決一覧に出す。移せたものだけ `fire: "spoken"` と source domain の `anchor` を持つ run にする。

v1 の `look` を持つ run は px 系の値を `scale: 1` の値として保存し、描画時に run の `scale` を掛ける。旧 `stroke.width_px` を移す際は `scale` で割った値を丸めずに保存し、描画時に掛けた後だけ px 値を丸める。旧 runs v0 の `style` は保存値を従来どおり直接描く。旧 `animation` は `dormant_animation` に保管し、描画しない。

`lookForCaptionRow` は `size: "keep"` なら当て先の実効 `size_px` を明示して保ち、`k = 当て先の size_px ÷ スタイルの size_px` で px 系の値を換算する。当て先の `reference_height_px` と `layout` も保つ。`size: "style"` で `layout` と `reference_height_px` が衝突するときは値を書かず、理由を返す。範囲への適用も行の実効サイズを使い、許可外の項目を落として通知する。

## 保存形と互換

字幕全体の見た目は `text_style` に値として保存する。新しい書き込みでは `style_preset` を使わない。旧形式の `style_preset` は現在の textstyle カタログで解決して読む。出所は描画に使わず、`style_sources: { look?, motion? }` に記録する。各 Source は `kind` (`builtin` / `library` / `my`)、`id`、`original_hash`、`applied_hash` を持ち、必要に応じて `uid`、`revision`、`applied_at`、`requires` を持つ。元の値と保存後の値を別々に照合できる。当て直しは部品全体の置換である。

`runs[]` は表示文字列（`display_text` があればそれ、なければ `text`）の書記素による半開区間 `from` / `to` を持つ。v1 の id は `r-` と 4 桁以上の数字で、ファイル全体で一意にする。新しい id は `unresolved_runs[].run` も含むファイル内の最大番号に 1 を足して作る。任意の `role`、`emotion`、`look`、`motion`、`anchor`、`fire`、`style_sources`、`needs_review`、`split_from`、`migrated_from`、`migrated_emphasis`、`fire_was`、`dormant_animation` を持てる。`migrated_emphasis` は元の `emphasis_words` の `index` と `item` を持つ。範囲の効果音と `effect` は v1 では保存しない。重なる範囲では後の run の項目が勝つ。

| 移行で新しく作る run のキー順 | 内容 |
|---|---|
| `id, from, to, role, emotion, migrated_from, migrated_emphasis, fire, anchor, motion` | 元の項目は `migrated_emphasis.item` にそのまま保存し、`index` で配列内の順序を復元する。 |

旧 runs の `style` は読むときに `look` に投影する。ただし表示文字列の書記素数に対して範囲外または空の旧 run は投影も移行もせず、id を付けずに元の形で残し、文書全体の件数を通知する。旧 `animation` は描画されていなかったため `dormant_animation` に保存し、明示的に有効化するまで `motion` にしない。旧 `emphasis_words` は素材・時刻・語から行と文字範囲を一意に決められる場合だけ投影する。移行した項目は `migrated_from` と `migrated_emphasis` を付け、元の `emphasis_words` から除く。複数回の移行でも `migrated_emphasis.index` は最初の配列での位置を使い、既存の移行済み run と重複させない。一意に決まらない項目は残して通知する。未移行の `style_preset` は描画時に解決するため、見た目の固定は移行後から保証される。出所の `original_hash` と `applied_hash` は鍵を再帰的に整列した JSON を UTF-8 のバイト列にして SHA-256 で計算し、`sha256:` と 64 桁の十六進数で記録する。

## look と大きさ

行の許可項目は `color`、`size_px`、`reference_height_px`、`font_family`、`font_weight`、`weight`、`line_height`、`letter_spacing_em`、`text_transform`、`fill`、`strokes`、`stroke`、`background`、`shadow`、`glow`。範囲の許可項目は `color`、`font_weight`、`italic`、`underline`、`letter_spacing_em`、`scale`、`baseline_shift_em`、`rotate_deg`、`stroke`、`shadow`、`glow`、`background`。範囲に `size_px` と `font_family` は保存しない。許可外の項目は除く。`size_px` と `reference_height_px` は範囲に元から無いため通知せず、`font_family` などは通知する。

大きさを保って当てる場合、保存値に `k = 当て先の size_px ÷ スタイルの size_px` を掛ける。換算対象は `stroke.width_px`、`strokes[].width_px / offset_x / offset_y`、`shadow.blur_px / distance_px`、`glow.spread / offset_x / offset_y`、`background.padding_px / radius_px`、`fill.pattern.scale`。色、透明度、角度、em 値は換算しない。当て先の `size_px` と `reference_height_px` を保ち、`size_px` が未指定なら実効値を明示する。`layout` のときも基準の `size_px` の比で計算し、描画の最終段で layout 倍率を一度掛ける。範囲の px 値は行の座標系で `scale: 1` の値として保存し、描画時に範囲の `scale` を掛ける。出力高さによる `output.height / reference_height_px` も一度だけ掛ける。

## 文字範囲の寿命

文字の変更では書記素単位の複数差分を対応付ける。共通の先頭と末尾を確定してから中央を対応付ける。通常の文字編集では、置換・削除の内側に丸ごと入る run を外す。表示文字列と原文の座標変換および単語帳の置換では、置換の内側に丸ごと入る run を置換後の区間へ写して `needs_review` を付け、挿入の無い削除の内側だけを外す。境界をまたぐ run は伸縮して `needs_review` を付ける。同点の対応も `needs_review` を付ける。行を分割して境界をまたぐ場合、左は元の id、右は新 id と `split_from` を持つ。anchor は両側の行の時刻へ切り詰め、空になった `spoken` 側は `shown`、`fire_was: "spoken"`、`needs_review: true` にする。隣接 run は自動結合しない。行が消えたか対応先が決まらない run はルートの `unresolved_runs[]` に `{ run, old_caption_id, old_text, old_src, old_start, old_end, reason }` として保持し、描画対象から外す。選んだ文字を行の見た目に戻す操作は、重なる各 run からその部分を切り取り、必要なら右側に新 id を与える。

## anchor と発火

`anchor` は `{ src?, start, end, domain }`。`domain` は `source` または `output`。`fire` は `shown`（既定）、`spoken`、`whole`。`spoken` には anchor が要る。`words[].text` の連結が行の `text` と一致するときだけ文字オフセットから実測 words に対応付ける。`display_text` が異なる場合は単語帳の文字対応を使い、対応がなければ anchor を付けず `captions.run.anchor-unmapped` を通知する。実測されていない時刻は作らない。

source anchor は字幕が描かれる同じ素材の配置ごとに、速度とカットを反映して出力時刻へ写す。同じ素材の複数配置も別々に扱う。表示窓の始まりは行の開始時刻と配置の `in` の遅い方を写す。区間がすべてカットされた場合は `shown` に落とし `captions.run.anchor-cut` を通知する。output anchor は素材配置を参照せず、字幕の表示窓へ切り詰める。発火が窓より前なら窓の始まり、窓より後なら `fire: "none"` として動かさず静止の look だけを表示する。窓の外は warning で知らせる。

動きの in は発火から始まり、out は字幕の終わりに終える。残る時間が in と out の合計より短ければ両者を同じ比で縮め、loop は回さない。

## 検証

構造は captions schema が判定する。文書の意味では v1 run の範囲外、ファイル内の run id 重複、anchor のない `spoken` を error として保存を拒む。`validate-captions` も文書の意味の層を呼び、error があれば非 0 で終了する。旧 runs v0 の範囲外・空の区間は従来どおり `captions.run-range` の warning とする。意味の error は診断を出す。描画経路での除外は後の版で行う（除外に使う純関数 `renderableCaptionRuns` は用意済み）。プロジェクトの意味では anchor の写像不能や表示窓の外を warning とし、経路の対応では選んだ描画経路が motion を描けるか判定する。診断はコード・重大度・パス・日本語メッセージを共有する。
