# 字幕の見た目 v1 — 保存・換算・範囲・時刻・検証

- 日付: 2026-10-12
- 状態: v1

## 移行と書き出し

移行は主経路（`resolveCaptionPlan` を通る書き出しとプレビュー）で、前後の HTML と CSS 変数を保つ。移行済みの強調範囲は、描画時に `migrated_emphasis` に保存した元の項目と移行前の配列内の位置から `emphasis_words` へ戻す。残った項目の順を保ち、移した項目を位置の昇順に差し込む。追加のプロパティと項目の順序も保つ。旧形式だけの入力はそのまま描画器へ渡す。

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

スタイルを既存の字幕や選んだ文字に当てるときは、大きさを運ばない。既存の `size_px` を保ち、値が無い場合だけ実効の大きさを明示する。新しい文字を置くときだけ、スタイルの推奨 `size_px` と `reference_height_px` を初期値にする。大きさはスタイルの適用とは別の操作で変える。

CLI の既存の大きさ指定の互換経路を除き、画面から `size: "style"` は使わない。

大きさを変えると、その行の look と範囲の look の px 系の値は同じ比で変わる。行が受け継いだ成分は描画と同じ `mergeCaptionDisplayStyles` で実効値に解き、影・グローの色や濃さも含むオブジェクト全体を、px 値を換算して行へ保存する。換算対象の px 値を持たない成分は行へ書かない。既定値そのものとほかの行は変更しない。旧 `style_preset` を持つ行は現在のカタログで先に値へ解いてから換算する。

スタイルを範囲に当てる操作は、その範囲の look 全体を置き換える。スタイルに縁・影・グローの指定が無ければ、それぞれ `stroke: {width_px: 0}`、`shadow: {opacity: 0}`、`glow: {density: 0}` のように「無し」を明示する。これらを明示した範囲では行の同じ成分を描かない。色・太さ・字間はスタイルに無ければ行を継ぐ。

行の許可項目は `color`、`size_px`、`reference_height_px`、`font_family`、`font_weight`、`weight`、`line_height`、`letter_spacing_em`、`text_transform`、`fill`、`strokes`、`stroke`、`background`、`shadow`、`glow`。範囲の許可項目は `color`、`font_weight`、`italic`、`underline`、`letter_spacing_em`、`scale`、`baseline_shift_em`、`rotate_deg`、`stroke`、`shadow`、`glow`、`background`。スタイルの `weight` が 1～1000 の整数で、`font_weight` が無い場合は、範囲の `font_weight` に写す。範囲に `size_px` と `font_family` は保存しない。範囲に写せない行用項目は外し、`size_px` と `reference_height_px` を除いて名前を挙げて通知する。

大きさを保って当てる場合、保存値に `k = 当て先の size_px ÷ スタイルの size_px` を掛ける。換算対象は `stroke.width_px`、`strokes[].width_px / offset_x / offset_y`、`shadow.blur_px / distance_px`、`glow.spread / offset_x / offset_y`、`background.padding_px / radius_px`、`fill.pattern.scale`。色、透明度、角度、em 値は換算しない。当て先の `size_px` と `reference_height_px` を保ち、`size_px` が未指定なら実効値を明示する。`layout` のときも基準の `size_px` の比で計算し、描画の最終段で layout 倍率を一度掛ける。範囲の px 値は行の座標系で `scale: 1` の値として保存し、描画時に範囲の `scale` を掛ける。出力高さによる `output.height / reference_height_px` も一度だけ掛ける。

## 文字範囲の寿命

台本では選んだ語を、表示文字列の書記素による半開区間へ写す。語の両端の空白は含めず、行の見た目へ戻すときは範囲を外側に隣り合う空白まで広げる。実測 `words` の連結が本文に一致しなければ当てない。本文と表示文字列が異なる場合は、選んだ語の境界の対応で決まる範囲と重なる同じ文字列だけを候補にし、一意ならその範囲を使う。重なる候補が無いか一意に決まらなければ境界の対応で決まる範囲（置換後の文字を含む）を使い、境界も決まらなければ当てない。置換した語の隣に同じ語があっても、その隣には当てない。置換に触れていない語は、同じ文字列の範囲にだけ当てる。台本の語の印も、対応の取れない行の run からは作らない。選んだ文字の枠は出力プレビューの編集用の層に描く。表示中の文字の見た目の行ごとに点線の枠を置き、字幕の DOM や書き出しには含めず、タイムラインやプロジェクトを切り替えると消す。

範囲への適用と範囲を行の見た目へ戻す操作では、選択範囲の両端の空白を除いてから、重なる旧 `emphasis_words` を同じ書き込みで除く。`time_domain: "output"` の行と、双方に `src` があり素材が食い違う強調は対象外。範囲の実測時刻が取れるときは強調の `[t_start, t_end]` と 1e-6 秒を超えて重なることを要する。取れないときは強調の時刻が行の `[start, end]` に収まることを要する。実測時刻が取れ、双方に `src` がある場合はここで重なりとし、それ以外は強調の `word` が表示文字列で選択範囲と重なる位置に現れることも要する。

文字の変更では書記素単位の複数差分を対応付ける。共通の先頭と末尾を確定してから中央を対応付ける。通常の文字編集では、置換・削除の内側に丸ごと入る run を外す。表示文字列と原文の座標変換および単語帳の置換では、置換の内側に丸ごと入る run を置換後の区間へ写して `needs_review` を付け、挿入の無い削除の内側だけを外す。境界をまたぐ run は伸縮して `needs_review` を付ける。同点の対応も `needs_review` を付ける。行を分割して境界をまたぐ場合、左は元の id、右は新 id と `split_from` を持つ。anchor は両側の行の時刻へ切り詰め、空になった `spoken` 側は `shown`、`fire_was: "spoken"`、`needs_review: true` にする。隣接 run は自動結合しない。行が消えたか対応先が決まらない run はルートの `unresolved_runs[]` に `{ run, old_caption_id, old_text, old_src, old_start, old_end, reason }` として保持し、描画対象から外す。選んだ文字を行の見た目に戻す操作は、重なる各 run からその部分を切り取り、必要なら右側に新 id を与える。残した各部分の anchor はその範囲で取り直し、取れなければ外す。anchor を失った `spoken` は `shown`、`fire_was: "spoken"`、`needs_review: true` にする。run が無くなれば空の `runs` は残さない。

## anchor と発火

`anchor` は `{ src?, start, end, domain }`。`domain` は `source` または `output`。`fire` は `shown`（既定）、`spoken`、`whole`。`spoken` には anchor が要る。`words[].text` の連結が行の `text` と一致するときだけ文字オフセットから実測 words に対応付ける。`display_text` が異なる場合は単語帳の文字対応を使い、対応がなければ anchor を付けず `captions.run.anchor-unmapped` を通知する。実測されていない時刻は作らない。

source anchor は字幕が描かれる同じ素材の配置ごとに、速度とカットを反映して出力時刻へ写す。同じ素材の複数配置も別々に扱う。表示窓の始まりは行の開始時刻と配置の `in` の遅い方を写す。区間がすべてカットされた場合は `shown` に落とし `captions.run.anchor-cut` を通知する。output anchor は素材配置を参照せず、字幕の表示窓へ切り詰める。発火が窓より前なら窓の始まり、窓より後なら `fire: "none"` として動かさず静止の look だけを表示する。窓の外は warning で知らせる。

動きの in は発火から始まり、out は字幕の終わりに終える。残る時間が in と out の合計より短ければ両者を同じ比で縮め、loop は回さない。

## 検証

構造は captions schema が判定する。文書の意味では v1 run の範囲外、ファイル内の run id 重複、anchor のない `spoken` を error として保存を拒む。`validate-captions` も文書の意味の層を呼び、error があれば非 0 で終了する。旧 runs v0 の範囲外・空の区間は従来どおり `captions.run-range` の warning とする。意味の error は診断を出す。描画経路での除外は後の版で行う（除外に使う純関数 `renderableCaptionRuns` は用意済み）。プロジェクトの意味では anchor の写像不能や表示窓の外を warning とし、経路の対応では選んだ描画経路が motion を描けるか判定する。診断はコード・重大度・パス・日本語メッセージを共有する。

## 書き込みの境界

`writeProjectFilesTransactional(projectRoot, { files, label })` は、プロジェクト内の相対パスごとに `expectedHash` と `next` を受け取る。`expectedHash` は生のバイト列の SHA-256 を `sha256:<64 桁の十六進数>` で指定する。`null` はファイルが無いことを期待し、省略時は比較しない。`next: null` は比較だけを行う。読んだだけの `edit.json` なども比較へ含められる。1 件でも違えば何も書かず、`ConflictError` の `files` に競合した相対パスを返す。

書き込みは `.akari/write.lock` の排他作成でプロセス間を直列化する。lock の持ち主が同じホストで終了した場合、または作成から 30 秒を超えた場合は取得し直せる。同じプロセス内でもプロジェクトごとに順番を保つ。比較のない書き込みは lock の下でファイルごとに一時ファイルから rename し、途中で失敗しても先に書いたファイルを戻さず、journal と `.akari/work/` は作らない。比較つきの書き込みは、変更前に `.akari/write-journal.json` と `.akari/work/journal/<id>/` の元バイト列を保存する。途中で失敗したら元のバイト列に戻す。すべての rename が済んだら journal に `committed: true` を記録し、片付けに失敗しても保存は成功とする。

lock を待つ側は `.akari/write.lock.wait` に印を置く。放す側は lock を消した後でその印を消し、待ち手に短く取得を譲る。

書き込み先の相対パスは正規化し、同じファイルを指す鍵の重複、代替データストリームの `:`、lock・journal・退避先を拒む。`./edit.json` は `edit.json` として扱う。比較する hash は生バイトを基準にするが、UTF-8 BOM 付きのファイルでは BOM を除いたバイト列の hash も一致として受け入れる。元の BOM は取り消し用の変更前全文に残す。

比較がすべて通った後、実際に書く各ファイルの rename 直前に `onWillWrite(destination, name)` を呼び、rename 完了後に同じファイルの `onDidWrite` を呼ぶ。競合や内容が同じため書かないファイルにはどちらも通知しない。

次の書き込みの前に journal が残っていれば回復する。`committed: true` なら戻さず片付ける。印がなければ現在の内容が止まった書き込みの値と一致するファイルだけ元に戻し、元の値と一致するものはそのままにする。どちらでもないファイルや退避が読めないファイルは触らず通知する。journal が壊れていれば退避し、ファイルは触らない。回復通知は保存結果の `recovered` と `onRecovered` で受け取れる。journal が無ければ起動時の回復は lock を取らず直ちに終わる。

## 見た目の編集コマンド

見た目の編集コマンドは文の `notices` と種類を示す `notice_codes`（`{code, params?}`）を返し、画面はコードから表示言語の文を作る。`planCaptionStyleEdit` は `captions`、`targets`、`parts`、`source` を受け、副作用なしに `next` と `changed` も返す。対象は `{caption_id}`（行）、`{caption_id, range}`（文字範囲）、`{default:true}`（既定スタイル）。対象ごとに `parts` を上書きできる。`range` は書記素の半開区間 `{from,to}`、または `{quote,occurrence}` で指定する。引用の候補は NFC にそろえ、左から重ならないように数える。一致後はその末尾から次を探す（「ああああ」の「ああ」は 2 件）。返す位置は元の文字列の書記素単位。同じ引用が複数あれば 1 始まりの `occurrence` が必要。引用が見つからない場合や範囲が空・範囲外の場合は失敗する。範囲の効果音と効果は使えず、行の効果音と効果は従来の attach 経路で扱う。

行の look は許可項目を部品ごとに置換し、動きは `animation` 全体を置換する。範囲は `runs[].look` と `runs[].motion` を置換し、許可外の look 項目を外して通知する。範囲に look を当てるときは、重なる既存の run を行の見た目へ戻す操作と同じように切ってから置く。同じ区間の v1 run は id を保って置き換え、新しい区間にはファイル全体で一意の id を付ける。実測 words に対応付けられる場合だけ anchor を付ける。行の旧 `style_preset` は現在のカタログで値に解き、出所を記録してから外す。カタログに無ければ元の指定を保って通知する。配列ルートに `{default:true}` を当てた場合は `{default_text_style,captions}` にする。

スタイルを当てても大きさは変えない。行の既存の `size_px` と `reference_height_px` を保ち、`size_px` が無ければ実効値を明示する。px 系の値は当て先の大きさに換算する。`style_sources.look` の hash は look の許可項目から `size_px` と `reference_height_px` を除いた値に付ける。`original_hash` は出所の値、`applied_hash` は換算後に保存した値である。`applied_at` には適用時刻を記録する。

`planCaptionStyleClear` は run の指定全体を消す `mode: "run"`、選んだ文字を重なる run から切り取る `mode: "range"`、範囲指定のない `{caption_id}` で行の look・動き・出所・旧 preset を消す操作を扱う。行の大きさと配置は保つ。`planCaptionStyleReapply` は出所の現在の値を引き、部品ごとに `same`、`updated`、`missing` と手直しの有無を返す。`apply` に指定した部品だけ値を当て直す。出所が無ければ値を保って通知する。

`planCaptionSizeEdit({captions,targets,size_px})` は行の大きさと、その行の look および範囲の look の px 系の値を、`新しい大きさ ÷ 変更前の実効の大きさ` で変える。小数は 6 桁に丸め、`reference_height_px` を保つ。比が 1 なら変更しない。元の `applied_hash` と値が一致していた部品は換算後の hash に更新し、大きさの変更だけで手直しとは判定しない。

編集コマンドは変更した行の `text_style` を書く前後で描画と同じ合成・検査へ通し、すべてのエラーを集めて比べる。書いた後にだけあるエラーがあるときだけ拒むため、複数のエラーがある行も一つずつ直せる。変更していない行は対象にしない。

Node 側の `applyCaptionStyle`、`clearCaptionStyle`、`reapplyCaptionStyle`、`setCaptionSize` は読んだ全文の hash を比較してから保存し、書く前と後の全文・hash を返す。対象ファイルは既定の `captions.json` / `edit.json` に加え、プロジェクト直下の対応する `captions.<slug>.json` / `edit.<slug>.json` を指定できる。期待 hash は役割名（`captions` / `edit`）または実ファイル名で受け、前後の全文と `written` は実ファイル名を鍵にする。読んだだけのファイルも競合の比較に含める。保存前に v1 の項目の形と文書の意味を検査し、error があれば `AKARI_CAPTIONS_INVALID` と診断を返して書かない。形の検査は旧い行の他の項目や v0 の run の形を理由に拒まない。edit-lint も同じ v1 の形の診断を表示する。

書き込み lock の奪取に使う `.akari/write.lock.claim` は所有者の pid と host を記録し、同じホストの正の整数 pid だけを生存判定する。使用中の claim は保ち、自分の取り残しはすぐ消す。生きた所有者の claim も作成から 30 秒を超えれば消し、死んだ所有者や読めない claim は 5 秒を超えれば消す。claim を取った後、古い lock は claim の中へ退かしてから中身を確かめる。奪取対象だった lock と異なれば元の場所へ戻して取得せず、退かす直前に claim が自分のものでなくなっていれば奪わない。書き込み先のフォルダに作成権限が無いと確かめたときは権限エラーを返し、書けると分かった後の lock 作成は待ち上限まで再試行する。
`.akari/write.lock.claim` とその下、および試し書き名 `.akari/write.lock.probe-*` は書き込み先に指定できない。

## 移行と CLI

アプリはプロジェクトを開いたとき、未移行の行があれば一度だけ見た目の固定を提案する。確認前には書かない。「あとで」または実行の後はそのプロジェクトの同じ字幕ファイルには再提案しない。固定の保存は読んだときの hash を比較し、履歴の 1 件として記録するため、1 回の取り消しで元のバイト列へ戻せる。CLI からは `akari captions migrate-look <project> [--dry-run] [--json]` で差分の確認と保存ができる。

移行と preset の解決には同梱とライブラリを合わせた現在の textstyle カタログを使う。移行は現在の edit.json も読んで計画し、書き込む前の字幕データを保存境界の期待 hash として扱う。出所を指定せず look または motion を当てた場合、その部品の古い `style_sources` を消す。両部品の出所が無くなれば `style_sources` 自体を消す。

CLI の `--caption <index>` は id の無い行や id が重複した行にも index で当てる。`--caption <id>` は id で指定する。CLI の JSON 出力の `changes[].before` と `changes[].after` は実際に計画または保存した文書の値を示す。

アプリの `applyCaptionStyle`、`clearCaptionStyle`、`reapplyCaptionStyle`、`setCaptionSize`、`migrateCaptionLook` は projectRootUri と対象 URI を検査し、`captionsUri` と対になる edit のあるフォルダを根として別名の組も扱い、任意の期待 hash を受ける。成功は実ファイル名で書いたファイル、通知、前後の全文と hash を返す。`writeEditSnapshot` の期待 hash も edit と captions の役割に対応する候補を比較する。競合は `conflict: true`、検証エラーは `invalid: true` と診断を返し、どちらも書かない。中断した書き込みは `recoverInterruptedWrite` で元に戻す。アプリはプロジェクトを開いたときに回復を試み、通知を表示する。字幕スタイルの undo と redo は前後の全文を各 1 件の履歴に持ち、保存後の hash と一致するときだけ逆向きに書く。競合したら読み直して取り消しややり直しを失敗として知らせる。

移行の保存はプロジェクト直下の `captions.json` と `captions.<slug>.json` を対象にし、対応する edit を比較する。強調語の id は移行済みと未解決の run に残る `migrated_from` も予約済みとして採番する。古い強調語と run の id が重なれば、強調語に新しい id を与えてから移す。旧い強調と同じ範囲・同じ内容の run があれば増やさず、未解決 run を含めて採番する。主経路と取り出した字幕は移行の前後で同じ見た目になる。

`akari-apply-textstyle` の既存の対象指定、`--dry-run`、JSON 出力と終了コードは保つ。保存には同じ書き込み境界を使う。行に当てた場合は `style_sources.look` を記録し、旧 `style_preset` を値に解いて外す。既存の CLI が行っていた深い合成は互換のため維持する。
