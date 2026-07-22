# plan.json — 素材ゼロから仮枠タイムラインを確定する

正本契約: [contract-2026-07-20-plan-json-v0.md](../../docs/contract-2026-07-20-plan-json-v0.md)。
本リーフは [workflow.md](workflow.md) §2「素材がゼロの場合」の分岐からだけ読む。
録画素材がある場合は plan.json を作らず、従来どおり分析統合からチャットでの方針提示へ進む
（確度に応じてステップを飛ばせる 1 本のパイプライン。仮枠は方向性が不確かなときだけ効く）。

## 1. 質問対話で方針を深掘る

- 選択肢式（ABC 回答）の質問を 1 問ずつ重ね、目的・尺・トーン・構成ビートを確定させる。
  1 問 = 1 決定にし、複合質問で回答を曖昧にしない
- 対話サーフェスは [decision-cards](../../packages/decision-cards/) の既存機構を
  そのまま使う: `<plan-dir>/plan-dialogue.html` + `<plan-dir>/plan-dialogue.html.decisions.json`
  の別ペアを作り、`node packages/decision-cards/report-helper.mjs` で提示する。
  ヘルパー不通時はチャットの明示承認で代替し、その旨を記録する（[approvals-and-generation.md](approvals-and-generation.md)
  の Checkpoint 運用と同じ代替規約）
- この decisions.json は plan-dialogue 専用であり、`decision-log.md`（判断記録）とはファイルを
  分ける。混ぜない（decisions.json = 対話の生データ、decision-log.md = 確定した決定の要約）

## 2. plan.json を書く

- 置き場所は `<plan-dir>/plan.json`（`decision-log.md` と同じディレクトリ。AKARI プロジェクトでは
  `planning/` ロールが既定）
- 対話で決まった構成ビートを `slots[]`（配列順 = timeline 順、`start` は書かない）に、
  決定事項（尺の上限・確定尺・位置つき指示）を `constraints[]` に落とす。
  書式・必須キー・null 規約は契約 §1 のフィールド表に従う
- 対話中の slot は `confidence: "proposed"` + `fill.method: null` で書き始めてよい。
  人間が対話で確定させた項目だけを `locked` にする。**AI の判断で locked にしない**
- 同一ファイルを段階的に更新する（`decision-log.md` への追記と同じ、確定した事実だけを積み増す
  規律）。決定の経緯は対話の decisions.json が持つため、plan.json 側には結果だけを書く
- 書いたら毎回検証する:
  `node packages/schemas/bin/validate-plan.mjs <plan-dir>/plan.json`
  （error 0 件を維持。warning は仮枠の未成熟として許容されるが、完了報告に列挙する）

## 3. 確定と接続

- 方針が確定したら（対話 decisions.json の `completedAt` 非 null、またはチャット明示承認）、
  `.akari/events/` に gate event `plan-confirmed` を記録する
- 以降の工程（[report-guide.md](report-guide.md) の「方針をチャットで決める」節）では、
  編集方針のチャット提示が plan.json の slot id を根拠として参照する。台本や構成をチャット側で
  再フリーテキスト化しない（2026-07-22 改訂: レポート生成は analyze-project へ移管済み。
  plan.json の位置づけ自体は変わらない）
- BGM・SFX・B ロール等の素材三択（提案/生成/不採用）は従来どおり
  [report-guide.md の「素材計画」節](report-guide.md#素材計画)の管轄。plan.json には
  持ち込まない（契約 §5）

## 4. 仮枠プレビュー（現時点の運用）

仮枠の再生 QA は「静止画 + TTS + テキストカードを通常の edit.json v1 にコンパイルする」
規約（契約 §6）で行う設計だが、**コンパイラは未実装**。当面は静止コンセプトをチャットで
提示する従来運用（workflow.md §2）を維持し、動画生成は承認工程まで保留する。
コンパイラ実装後にこの節を差し替える。
