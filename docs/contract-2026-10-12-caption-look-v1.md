# 字幕の見た目 v1 — 保存・換算・範囲・時刻・検証

- 日付: 2026-10-12
- 状態: v1

## 移行と書き出し

移行は render-cut の書き出し結果（HTML と CSS 変数）を保つ。移行済みの強調範囲は、描画時に `migrated_emphasis` に保存した元の項目と移行前の配列内の位置から `emphasis_words` へ戻す。残った項目の順を保ち、移した項目を位置の昇順に差し込む。追加のプロパティと項目の順序も保つ。旧形式だけの入力はそのまま描画器へ渡す。かごから取り出した字幕と GPU の適格判定も、主経路と同じプリセット解決・v1 描画入力の前処理を通す。移行していない字幕アイテムの従来の描画は保つ。

| `style_hint`（省略時の `emotion`） | `motion.in.id` |
|---|---|
| `one-char-bang`（`pain`、`surprise`、`anger`） | `pop` |
| `one-char-jumble`（`disgust`） | `jitter` |
| `size-pulse`（`joy`、`emphasis`） | `zoom-pulse` |

この対応に無い hint、別の hint と同じ motion になるもの、項目ごとの `style_preset` を持つもの、語が行の表示文字列に一意に現れないもの、時刻が行の外に出るものは `emphasis_words` に残し、通知と未解決一覧に出す。移せたものだけ `fire: "spoken"` と source domain の `anchor` を持つ run にする。

v1 の `look` を持つ run は px 系の値を `scale: 1` の値として保存し、描画時に run の `scale` を掛ける。旧 `stroke.width_px` を移す際は `scale` で割った値を丸めずに保存し、描画時に掛けた後だけ px 値を丸める。旧 runs v0 の `style` は保存値を従来どおり直接描く。旧 `animation` は `dormant_animation` に保管し、描画しない。

`lookForCaptionRow` は `size: "keep"` なら当て先の実効 `size_px` を明示して保ち、`k = 当て先の size_px ÷ スタイルの size_px` で px 系の値を換算する。当て先の `reference_height_px` と `layout` も保つ。`size: "style"` で `layout` と `reference_height_px` が衝突するときは値を書かず、理由を返す。範囲への適用も行の実効サイズを使い、許可外の項目を落として通知する。

## 範囲の描画

範囲の `stroke.width_px`、台紙の `padding_px` と `radius_px`、影とグローの px 値は、保存時には行の座標系で `scale: 1` の値とする。描画時に行の実効倍率（`reference_height_px` なら出力高さとの比、`layout` ならその解決倍率）と範囲の `scale` を一度ずつ掛ける。解決済みの値を再解決しても倍率は重ねない。

台紙は範囲と行の交差部分ごとに作る。各断片の文字の矩形を `padding_px` だけ四方へ広げ、`radius_px`、`color`、`opacity` をその断片に適用する。幅・高さ・合わせ方・位置・モードの指定は範囲の台紙には使わない。台紙は文字を持たない `akari-caption__run-frag[data-akari-plate]::before` で描き、文字の読み取り・選択・コピーには加わらない。

重なり順は行の台紙、範囲の台紙（run の配列順で後ろほど上）、文字の順とする。回転と上下のずらしは断片の中心を原点にして台紙と文字本体へ同じ変換を掛ける。影とグローは範囲で指定した成分だけ行の指定を置き換え、指定しない成分と行の内側の縁・押し出しは継ぐ。明示的に空の影またはグローを指定すると、その成分を「無し」にする。影の写しは本体と同じ縁幅を保ち、縁の色だけ透明にする。

文書の意味検証で error となった run は描かない。範囲が 1 つの語要素の中に収まるか、語要素を端から端まで含む場合は台紙を 1 つにする。語要素の途中から別の語要素へ続く場合、および交差する run の重なり順を保つ必要がある場合は、台紙を分けて `data-akari-plate-split` を付ける。前後の run が端を共有して包含するだけなら分けない。語の途中から別の語へ続く台紙には warning を出す。

GPU は解決済みの台紙余白と影・グローのはみ出しをインクの矩形に含め、回転した断片の矩形も広げる。語ごとのタイル表示と範囲の台紙・影・グローが重なる場合は GPU を非対応として別経路へ送る。帯とスプライトには字幕ごとに限定した CSS 規則と変数を渡す。

旧形式の範囲に `stroke.width_px` があり、行または既定スタイルに `reference_height_px` か `layout` がある場合、その範囲は自動移行せず旧形式のまま残して通知する。他の範囲は `style` を `look` に移し、同じ run に両方を残さない。

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

## 書き込みの境界

`writeProjectFilesTransactional(projectRoot, { files, label })` は、プロジェクト内の相対パスごとに `expectedHash` と `next` を受け取る。`expectedHash` は生のバイト列の SHA-256 を `sha256:<64 桁の十六進数>` で指定する。`null` はファイルが無いことを期待し、省略時は比較しない。`next: null` は比較だけを行う。読んだだけの `edit.json` なども比較へ含められる。1 件でも違えば何も書かず、`ConflictError` の `files` に競合した相対パスを返す。

書き込みは `.akari/write.lock` を使ってプロセス間で直列化する。lock の持ち主が同じホストで終了した場合、または作成から 30 秒を超えた場合は取得し直せる。同じプロセス内でもプロジェクトごとに順番を保つ。ファイルを変える前に `.akari/write-journal.json` と `.akari/work/journal/<id>/` の元バイト列を保存し、各ファイルを一時ファイルから rename する。途中で失敗したら元のバイト列に戻す。

比較がすべて通った後、実際に書く各ファイルの rename 直前に `onWillWrite(destination, name)` を呼び、rename 完了後に同じファイルの `onDidWrite` を呼ぶ。競合や内容が同じため書かないファイルにはどちらも通知しない。

次の書き込みの前に journal が残っていれば回復する。現在の内容が止まった書き込みの値と一致するファイルだけ元に戻し、元の値と一致するものはそのままにする。どちらでもないファイルは後から変更されたものとして触らず通知する。journal が壊れていれば退避し、ファイルは触らない。回復通知は保存結果の `recovered` と `onRecovered` で受け取れる。従来の `writeProjectFilesGuarded` は同じ境界を使い、版の比較を省略する。

## 見た目の編集コマンド

`planCaptionStyleEdit` は `captions`、`targets`、`parts`、`source` を受け、副作用なしに `next`、`changed`、`notices` を返す。対象は `{caption_id}`（行）、`{caption_id, range}`（文字範囲）、`{default:true}`（既定スタイル）。`range` は書記素の半開区間 `{from,to}`、または `{quote,occurrence}` で指定する。同じ引用が複数あれば 1 始まりの `occurrence` が必要。引用が見つからない場合や範囲が空・範囲外の場合は失敗する。範囲の効果音と効果は使えず、行の効果音と効果は従来の attach 経路で扱う。

行の look は許可項目を部品ごとに置換し、動きは `animation` 全体を置換する。範囲は `runs[].look` と `runs[].motion` を置換し、許可外の look 項目を外して通知する。同じ区間の v1 run は更新し、新しい区間にはファイル全体で一意の id を付ける。実測 words に対応付けられる場合だけ anchor を付ける。行の旧 `style_preset` は現在のカタログで値に解き、出所を記録してから外す。カタログに無ければ元の指定を保って通知する。配列ルートに `{default:true}` を当てた場合は `{default_text_style,captions}` にする。

スタイルを当てても大きさは変えない。行の既存の `size_px` と `reference_height_px` を保ち、`size_px` が無ければ実効値を明示する。px 系の値は当て先の大きさに換算する。`style_sources.look` の hash は look の許可項目から `size_px` と `reference_height_px` を除いた値に付ける。`original_hash` は出所の値、`applied_hash` は換算後に保存した値である。`applied_at` には適用時刻を記録する。

`planCaptionStyleClear` は run の指定全体を消す `mode: "run"`、選んだ文字を重なる run から切り取る `mode: "range"`、範囲指定のない `{caption_id}` で行の look・動き・出所・旧 preset を消す操作を扱う。行の大きさと配置は保つ。`planCaptionStyleReapply` は出所の現在の値を引き、部品ごとに `same`、`updated`、`missing` と手直しの有無を返す。`apply` に指定した部品だけ値を当て直す。出所が無ければ値を保って通知する。

`planCaptionSizeEdit({captions,targets,size_px})` は行の大きさと、その行の look および範囲の look の px 系の値を、`新しい大きさ ÷ 変更前の実効の大きさ` で変える。小数は 6 桁に丸め、`reference_height_px` を保つ。比が 1 なら変更しない。元の `applied_hash` と値が一致していた部品は換算後の hash に更新し、大きさの変更だけで手直しとは判定しない。

Node 側の `applyCaptionStyle`、`clearCaptionStyle`、`reapplyCaptionStyle`、`setCaptionSize` は読んだ全文の hash を比較してから保存し、書く前と後の全文・hash を返す。対象ファイルは既定の `captions.json` / `edit.json` に加え、プロジェクト直下の対応する `captions.<slug>.json` / `edit.<slug>.json` を指定できる。期待 hash は役割名（`captions` / `edit`）または実ファイル名で受け、前後の全文と `written` は実ファイル名を鍵にする。読んだだけのファイルも競合の比較に含める。保存前に v1 の項目の形と文書の意味を検査し、error があれば `AKARI_CAPTIONS_INVALID` と診断を返して書かない。形の検査は旧い行の他の項目や v0 の run の形を理由に拒まない。edit-lint も同じ v1 の形の診断を表示する。

## 移行と CLI

移行と preset の解決には同梱とライブラリを合わせた現在の textstyle カタログを使う。移行は現在の edit.json も読んで計画し、書き込む前の字幕データを保存境界の期待 hash として扱う。出所を指定せず look または motion を当てた場合、その部品の古い `style_sources` を消す。両部品の出所が無くなれば `style_sources` 自体を消す。

CLI の `--caption <index>` は id の無い行や id が重複した行にも index で当てる。`--caption <id>` は id で指定する。CLI の JSON 出力の `changes[].before` と `changes[].after` は実際に計画または保存した文書の値を示す。

アプリの `applyCaptionStyle`、`clearCaptionStyle`、`reapplyCaptionStyle`、`setCaptionSize`、`migrateCaptionLook` は projectRootUri と対象 URI を検査し、`captionsUri` と対になる edit のあるフォルダを根として別名の組も扱い、任意の期待 hash を受ける。成功は実ファイル名で書いたファイル、通知、前後の全文と hash を返す。`writeEditSnapshot` の期待 hash も edit と captions の役割に対応する候補を比較する。競合は `conflict: true`、検証エラーは `invalid: true` と診断を返し、どちらも書かない。中断した書き込みは `recoverInterruptedWrite` で元に戻す。アプリはプロジェクトを開いたときに回復を試み、通知を表示する。字幕スタイルの undo と redo は前後の全文を各 1 件の履歴に持ち、保存後の hash と一致するときだけ逆向きに書く。競合したら読み直して取り消しややり直しを失敗として知らせる。

`akari captions migrate-look <project> [--dry-run] [--json]` は旧い見た目を値へ移す。`--dry-run` は差分と通知を出し、ファイルを書かない。差分が無ければ保存しない。競合した場合は終了コード 1 で再実行を案内する。保存前に形と意味を検査し、保存後も旧い書き出しの HTML と CSS 変数を保つ。

`akari-apply-textstyle` の既存の対象指定、`--dry-run`、JSON 出力と終了コードは保つ。保存には同じ書き込み境界を使う。行に当てた場合は `style_sources.look` を記録し、旧 `style_preset` を値に解いて外す。既存の CLI が行っていた深い合成は互換のため維持する。
