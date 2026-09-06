# おまかせ度に応じた編集手順

## 1. モードの読み方

`<project>/.akari/intake.json` を読む。

- ファイルが無い、`status: "draft"`、または `autonomy` が欠落している場合は `checkpoint` とみなし、[SKILL.md](SKILL.md) の現行手順（実行順 1〜11）へ進む。draft の `tasks` / `target` / `autonomy` には従わない。
- `status: "submitted"` かつ `autonomy: "full-auto"` の場合は、§2 の「そのまま」経路へ進む。
- `status: "submitted"` かつ `autonomy` が `checkpoint` / `collaborative` の場合は、現行手順（実行順 1〜11）へ進む。

## 2. そのまま（full-auto）の手順

`full-auto` では途中でチャット承認を求めず、次の順に進む。参照先の承認手順は通らず、出力ルールを使う。

1. 依頼文と `intake.tasks` を「入れる物のリスト」として固定し、**リストに無い物を足さない**。B ロール・BGM・演出・サムネ案の提案をしない。
2. 分析では、analyze-project の分析レポート（`analysis-report.html`）は**読まなくてよい**。事実層の `analysis.json`（`transcript` / `events`）だけを読む。無ければ [analyze-footage](../analyze-footage/SKILL.md) の既定（L0 + L1）を実行する。
3. 方針・素材計画をチャットで提示しない。決めた値（読み切り猶予・カット強度・字幕 preset 等の既定）は `decision-log.md` に決定者 `machine:director` で 1 行ずつ追記する。既存の [decision_log 表形式](report-guide.md#decision_log)（日時 / category / subject / 決定 / 理由 / 決定者 / 関連 checkpoint）を保ち、過去行は変更・削除しない。
4. [execution.md](execution.md) を読み、v2 の `edit.json` / `captions.json` / overlays を書く。字幕は execution.md §4 の手順に従い、§4 が `akari captions` に切り替わっていればそれを使う。字幕は語の時刻から作り、敷き詰めない。読み切り猶予の既定は 0.3 秒とする。依頼された出力に必要な場合だけ、[beats.md](beats.md)・[beat-sync.md](beat-sync.md)・[emphasis-detection.md](emphasis-detection.md)・[expression-selection.md](expression-selection.md) の出力ルールも参照する。`beats` / `emphasis_words` を v2 の `edit.json` へ書かず、語レベル演出は `captions.json` の `emphasis_words[]` へ書く。原本は変更せず、`edit.json` を書くのはディレクター 1 人とし、生成物には `<file>.meta.json` の provenance を残す。
5. 書いた直後に [edit-lint](../edit-lint/SKILL.md) を実行する。FAIL は直して再実行し、FAIL のまま書き出さない。直せなければ止まって報告する（§3）。lint 結果は `.akari/reports/` に保存する。
6. [render-cut](../render-cut/SKILL.md) の実行体の解決・書き出し手順を使い、`intake.target` の尺と出力仕様に従って書き出す。宣言はチャットに 1 行書くだけで承認を待たない。
7. 書き出し後に `akari capture` で 1〜2 枚（先頭の字幕が出る時刻と中盤）を `.akari/reports/` へ保存する。字幕が無い場合は先頭と中盤を使う。呼び出しは `akari capture -p <project> -t <先頭の字幕が出る秒> <中盤の秒> --separate --out <project>/.akari/reports/` とする。
8. 最後の報告に、出力 mp4 のパス・capture のパス・lint 結果のパスと結果（PASS / finding 件数）・`decision-log.md` に足した行数を添える。この報告を唯一のチャット出力とする（手順 6 の 1 行宣言と §3 の停止時の連絡を除く）。

## 3. 止まる条件（3 つだけ）

1. 人間が「確認して」と言った。言われた箇所以降で止まり、通常のチャット確認に戻る。
2. 有償または外部送信の生成が要る。[approvals-and-generation.md](approvals-and-generation.md) の Decision Communication Contract どおり宣言して回答を待つ。
3. lint FAIL を直せない。残った findings と直せない理由を報告する。

## 4. やらないこと

- 分析レポートの必読を課さない。分析レポートは読まなくてよい。
- Checkpoint 1〜3 を通らない。
- `plan-comments.json` を待たない。
- 推奨案・代替案を提示しない（§3 の生成宣言を除く）。
- `HUMAN_APPLY_GATE` を求めない。
- cut candidate bridge の review を待たない。無音短縮が `intake.tasks` に `silence-cut` として入っているなら、候補を review せず既定の閾値で適用し、採用した閾値と適用結果を `decision-log.md` に記す。

## 5. 記録

帳面（`decision-log.md`）への追記は必須。既存の表形式で、決定者は `machine:director` とし、判断の値・理由に加えて実行結果（生成物一覧・provenance・実行日時）を追記する。判断記録レポートの再描画は任意とする。
