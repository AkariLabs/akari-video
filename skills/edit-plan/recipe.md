# recipe.md — レシピ凍結と好みの記憶

正本契約: [contract-2026-07-25-recipe-v0.md](../../docs/contract-2026-07-25-recipe-v0.md)。
スキーマ: [recipe.schema.json](../../packages/schemas/recipe.schema.json)。
検証 CLI: `node packages/schemas/bin/validate-recipe.mjs <path>`。

本リーフは 2 つの独立した手順を持つ。**recall**（[workflow.md](workflow.md) の方針決めの前段
から読む）と **freeze**（実行承認後の完了処理から読む）。学習・自動適用はしない —
確認済みのみ記録し、出所付きで提示するだけのファイル契約である（契約 §0）。

## 1. recall 手順（方針決めの前段で行う）

方針をチャットで人間に提示する前に、一度だけ次を行う。

1. `~/.akari/recipes/` を列挙する（存在しなければ何もせず通常フローへ進む — error にしない）
2. `workflow: "edit"` のレシピだけを対象にする（`workflow: "research"` は無視する）
3. 該当レシピが 1 件以上あれば、`node packages/schemas/bin/validate-recipe.mjs` で検証してから
   使う（version が新しすぎて read-only 停止したレシピは無視して続行する — recall の失敗は
   工程を止めない。契約 §5 の劣化規約）
4. 検証を通ったレシピの `confirmed` を、**出所（`provenance[].confirmed_by` / `at`）を名乗る
   推奨**としてチャットで提示する。例:
   「前回の **<名前>**（<source_project>）では <aspect> / <target_duration_band> 等を
   採用していました。今回も同じにしますか、それとも今回用に決め直しますか」
5. 提示は**現在の依頼を上書きしない**。人間が明示的に「<名前>でもう一本」「前回と同じで」と
   採用を宣言したときだけ、対応する `confirmed` フィールドを今回の方針・素材計画へ**一括で**
   反映してよい（契約 §3 規律 3）。採用宣言が無ければ、レシピは参考情報のまま通常の
   Checkpoint 1〜3（[approvals-and-generation.md](approvals-and-generation.md)）を進める
6. レシピの提示は **intake の進め方フォーム等、必須質問をスキップさせる理由にしない**。
   レシピが見つかっても intake は通常どおり提出させる（契約 §3 規律 2）
7. 複数の `workflow: "edit"` レシピが見つかった場合は、`frozen_at` が新しいものを先頭にして
   候補一覧として提示する（自動選択しない。どれを使うか、あるいは使わないかは人間が選ぶ）

## 2. freeze 手順（完了処理で一度だけ申し出る）

Checkpoint 3（実行）の承認を得て `edit.json` と最終 overlay を作った後、**そのプロジェクトで
まだ freeze を提案していなければ**、一度だけ（offer-once）レシピ化をチャットで申し出る。
既に同一プロジェクト内で申し出済み（採用・却下いずれの回答でも）なら、二度と申し出ない
（契約 §3 規律 4）。

1. **確認済みの値だけを集める**。`confirmed` に書いてよいのは、人間が明示承認した
   チェックポイントを実際に通過した値だけである。推測やデフォルト採用で埋まった値は
   **確認済みのみ記録**の契約に反するため、たとえ最終出力に含まれていても記録しない
   （契約 §3 規律 1）。値ごとの出所は次のように対応させる（契約 §4）:
   - `intake`: 進め方フォーム（`intake.json`）提出で決まった値
   - `structure-confirm`: 研究/構成の確定決定カードで決まった値（edit-plan では通常発生しない。
     素材ゼロで plan.json 経由の企画確定を経た場合のみ該当）
   - `edit-approval`: Checkpoint 1（方針）/ Checkpoint 2（素材計画）の明示承認で決まった値
     （`caption_style_ref` / `bgm_profile` / `overlay_kinds` / `narration` は多くの場合ここ）
   - `render-approval`: Checkpoint 3（実行 manifest）の明示承認で決まった値
     （出力 `aspect` は多くの場合ここ）
2. 対象は `confirmed.aspect` / `target_duration_band` / `caption_style_ref` / `bgm_profile` /
   `overlay_kinds[]` / `narration`（`engine`/`voice`）のうち、実際に確認済みのものだけ。
   1 件も確認済みが無ければ freeze を申し出ない
3. 名前（kebab-case）を人間に確認する。既存の同名レシピがあれば上書きしてよいか確認する
   （無言上書きをしない）
4. `~/.akari/recipes/<name>.json` を組み立て、`node packages/schemas/bin/validate-recipe.mjs`
   で検証する（exit 0 を確認するまで保存済みとして扱わない）
5. 検証を通ったら `~/.akari/recipes/` に保存し（ディレクトリが無ければ作成する）、
   人間に次の定型文で確認する（呼び出し方まで教える。名前はシステムが思い出させるものであり
   ユーザーが暗記するものではない）:

   > **<名前>** として保存しました。今後のために記憶します。次回は『<名前>でもう一本』か『前回と同じで』と言ってください。

6. これでそのプロジェクトの freeze 申し出は完了（offer-once）。同じプロジェクト内で
   再度申し出ない。別プロジェクトで再び完了処理に到達したときは、新しい申し出として扱う

## よくある間違い

- 推測やデフォルト採用の値を `confirmed` に書く（人間が明示承認した値だけが確認済み）
- レシピの推奨値で今回の依頼を上書きする、または intake 等の必須質問をスキップする
- 同一プロジェクトで freeze を何度も申し出る（offer-once 違反）
- レシピ採用の明示宣言（「前回と同じで」等）が無いのに `confirmed` を無言で今回の計画へ流用する
- `~/.akari/recipes/` 以外（プロジェクト内 `planning/` 等）にレシピを保存する
- `validate-recipe.mjs` を通さずに freeze 完了として報告する
