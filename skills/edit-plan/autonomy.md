# おまかせ度に応じた編集手順

## 1. モードの読み方

動画を作る前に、作業場（CreatorRoot）直下の `akari.md` を読む。見つからなければ何もしない。続いて `<project>/.akari/intake.json` を読む。

優先順は **一言 > intake > akari.md > 製品既定**。

- intake のファイルが無い、`status: "draft"`、または `autonomy` が欠落している場合は `checkpoint`（提案つき）とみなし、§3 へ進む。draft の `tasks` / `target` / `autonomy` には従わない。
- `status: "submitted"` かつ `autonomy: "full-auto"` の場合は、§2 の「そのまま」経路へ進む。
- `status: "submitted"` かつ `autonomy: "checkpoint"` の場合は、§3 の「提案つき」経路へ進む。
- `status: "submitted"` かつ `autonomy: "collaborative"` の場合は、§6 の「一緒に作る」経路へ進む。
- 一言でのモード指定や `akari.md` の好みは上記の優先順で適用する。

**offer-once**: akari.md の調達の好み表に無い仕事に初めて当たったら 1 問だけ聞き、答えを akari.md の「聞かれて答えたこと」節へ 1 行足すことを申し出る。二度目は聞かない。**akari.md 本文の他の節は書き換えない**。

## 2. そのまま（full-auto）

`full-auto` では途中でチャット承認を求めず、次の順に進む。参照先の承認手順は通らず、出力ルールを使う。

1. 依頼文と `intake.tasks` を「入れる物のリスト」として固定し、**リストに無い物を足さない**。B ロール・BGM・演出・サムネ案の提案をしない。
2. 分析では、analyze-project の分析レポート（`analysis-report.html`）は**読まなくてよい**。事実層の `analysis.json`（`transcript` / `events`）だけを読む。無ければ [analyze-footage](../analyze-footage/SKILL.md) の既定（L0 + L1）を実行する。
3. 方針・素材計画をチャットで提示しない。決めた値（読み切り猶予・カット強度・字幕 preset 等の既定）は `decision-log.md` に決定者 `machine:director` で 1 行ずつ追記する。既存の [decision_log 表形式](report-guide.md#decision_log)（日時 / category / subject / 決定 / 理由 / 決定者 / 関連 checkpoint）を保ち、過去行は変更・削除しない。
4. [execution.md](execution.md) を読み、v2 の `edit.json` / `captions.json` / overlays を書く。字幕は `akari captions <project-dir>`（execution.md §4）を使う。字幕は語の時刻から作り、敷き詰めない。読み切り猶予の既定は 0.3 秒とする。依頼された出力に必要な場合だけ、[beats.md](beats.md)・[beat-sync.md](beat-sync.md)・[emphasis-detection.md](emphasis-detection.md)・[expression-selection.md](expression-selection.md) の出力ルールも参照する。`beats` / `emphasis_words` を v2 の `edit.json` へ書かず、語レベル演出は `captions.json` の `emphasis_words[]` へ書く。原本は変更せず、`edit.json` を書くのはディレクター 1 人とし、生成物には `<file>.meta.json` の provenance を残す。
5. 書いた直後に [edit-lint](../edit-lint/SKILL.md) を実行する。FAIL は直して再実行し、FAIL のまま書き出さない。直せなければ止まって報告する（§4）。lint 結果は `.akari/reports/` に保存する。
6. [render-cut](../render-cut/SKILL.md) の実行体の解決・書き出し手順を使い、`intake.target` の尺と出力仕様に従って書き出す。宣言はチャットに 1 行書くだけで承認を待たない。
7. 書き出し後に `akari capture` で 1〜2 枚（先頭の字幕が出る時刻と中盤）を `.akari/reports/` へ保存する。字幕が無い場合は先頭と中盤を使う。呼び出しは `akari capture -p <project> -t <先頭の字幕が出る秒> <中盤の秒> --separate --out <project>/.akari/reports/` とする。
8. 最後の報告に、出力 mp4 のパス・capture のパス・lint 結果のパスと結果（PASS / finding 件数）・`decision-log.md` に足した行数を添える。この報告を唯一のチャット出力とする（手順 6 の 1 行宣言と §4 の停止時の連絡を除く）。

## 3. 提案つき（checkpoint・既定）

1. 依頼文 + `intake.tasks` + akari.md の好みで「入れる物」を決める。**頼まれた物に加えて良さそうな物を足してよい**（B ロール・図解・テロップ演出・BGM・SE・章立て。足す判断は akari.md の調達の好み表に従う）。
2. 分析は事実層 `analysis.json` だけを読む。分析レポートの必読は課さない。無ければ [analyze-footage](../analyze-footage/SKILL.md) の既定（L0 + L1）を実行する。
3. 方針・素材計画をチャットで提示しない・承認を求めない。
4. **足した物 1 件ごとに `decision-log.md` へ「予測」1 行**を、タイムラインに入れるのと同じターンで書く。既存の [decision_log 表形式](report-guide.md#decision_log) を使い、ISO 8601 日時と `category = proposal` / `subject = item id または caption id` / `決定 = 何を入れたか` / `理由 = なぜ良さそうか（根拠 = analysis.json のどこ / akari.md のどの行）` / `決定者 = machine:director` / `関連 = 出所（素材 id・手段）` を記す。頼まれた物そのもの（提案でない物）には予測行を書かない。予測行の欠落は edit-lint の warning 止まりとする。
5. [execution.md](execution.md) の出力ルールで v2 の `edit.json` / `captions.json` / overlays を書き、書いた直後に [edit-lint](../edit-lint/SKILL.md) を実行する。FAIL は直して再実行する。直せなければ §4 に従って止まる。原本は変更せず、`edit.json` を書くのはディレクター 1 人とし、生成物には `<file>.meta.json` の provenance を残す。字幕は `akari captions <project-dir>`（execution.md §4）を使う。
6. **書き出さない（render-cut を呼ばない）**。最後に「入れた物 N 件（うち提案 M 件・帳面に M 行）・lint 結果・**プレビューで見て、要らなければ消してください。書き出しはヘッダの書き出しボタン**」を報告する。この報告が唯一のチャット出力となる（§1 の offer-once と §4 の停止時の連絡を除く）。
7. 人間が消した / 直した / そのまま出した の**結果行は書き出し時**に機械が追記する（render-cut 側・別票）。

## 4. 止まる条件（3 つだけ）

提案つき・そのまま共通。

1. 人間が「確認して」と言った。言われた箇所以降で止まり、通常のチャット確認に戻る。
2. 有償または外部送信の生成が要る。[approvals-and-generation.md](approvals-and-generation.md) の Decision Communication Contract どおり宣言して回答を待つ。
3. lint FAIL を直せない。残った findings と直せない理由を報告する。

## 5. やらないこと

そのままに加えて、提案つきにも適用する。

- 分析レポートの必読を課さない。分析レポートは読まなくてよい。
- Checkpoint 1〜3 を通らない。
- `plan-comments.json` を待たない。
- 推奨案・代替案を提示しない（§4 の生成宣言を除く）。
- `HUMAN_APPLY_GATE` を求めない。
- cut candidate bridge の review を待たない。無音短縮が `intake.tasks` に `silence-cut` として入っているなら、候補を review せず既定の閾値で適用し、採用した閾値と適用結果を `decision-log.md` に記す。

## 6. 一緒に作る（collaborative）

[SKILL.md](SKILL.md) の実行順 1〜11 と [approvals-and-generation.md](approvals-and-generation.md) の 3 段階チェックポイントをそのまま使う。`HUMAN_APPLY_GATE` と `plan-comments.json` の手順もこのモードで使う。

## 7. 記録

帳面（`decision-log.md`）への追記は必須。既存の表形式で、決定者は `machine:director` とし、判断の値・理由に加えて実行結果（生成物一覧・provenance・実行日時）を追記する。判断記録レポートの再描画は任意とする。

提案つきで足した物の予測行は §3-(4) に従う。人間の操作の結果行は書き出し時に追記する。
