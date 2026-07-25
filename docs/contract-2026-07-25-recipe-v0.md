# recipe.json v0（レシピ凍結と好みの記憶）契約

- 日付: 2026-07-25
- 状態: **ドラフト・要オーナーレビュー**（データ契約の新設はオーナー裁定事項。本書はレビュー前提の起草。
  特に §2 の置き場所 `~/.akari/recipes/` の新設は、プロジェクト外・ユーザーのホームディレクトリに
  永続ファイルを作る初めての契約であり、**オーナー裁定事項**として明記する）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（三原則の正本）、
  `contract-2026-07-25-plan-comments-v0.md`（直前の姉妹契約。文体・様式・ドラフト明記の先例）、
  `packages/schemas/intake.schema.json`（`target` 等の既存語彙。§6 参照）、
  `packages/schemas/edit.schema.json`（`narrationProvenance.engine`/`voice` の既存語彙）
- 発端: HyperFrames Studio 実機調査（オーナー指示 2026-07-24〜25・輸入リスト⑤）。差別化 (3)
  「セーブデータ SSOT + スタイル学習」の最初の一歩。競合の recipe freeze / remembered defaults
  規律（確認済みのみ記録・出所付き推奨・レシピ採用は一括確認・offer-once・初回記録の通知）を
  ファイル契約として輸入する
- スコープ: `recipe.json` のデータ形・置き場所・記録規律・提示規律のみ。**学習・自動適用・
  スコアリング・レシピの GUI は扱わない**（v0 は記録と提示のみ。§0・§9）

## 0. 位置づけ — 学習モデルではなくファイル契約

本契約は「モデルがユーザーの好みを学習する」仕組みではない。**人間が承認チェックポイントで
確認した選好の断面を、名前付きファイルとして凍結し、次のプロジェクトでスキルが読んで
出所付きの推奨として提示するだけ**のファイル契約 + スキル規律である。

- 推測やデフォルト採用で埋まった値は記録しない（§3 規律 1）。「ユーザーが推奨を見て受け入れた」
  という行為だけが確認とみなされる
- 記憶された値は今回の依頼を上書きしない。必須質問をスキップさせない（§3 規律 2）
- 自動適用・スコアリング・学習モデルの類は本契約の非スコープ（§9）。v0 は記録（freeze）と
  提示（recall）の 2 手順だけを持つ

版管理三原則（`contract-2026-07-17` §2、`contract-2026-07-25-plan-comments-v0.md` §0 に
倣う）を新設契約として初版から適用する:

- トップレベル `version` は**整数・0 起算**
- 進化は**追加のみ**。読み手は**寛容リーダー**（`additionalProperties: true`。未知フィールドは
  保持し、欠落は既定値で補う）
- 既知より大きい `version` を見た読み手は推測変換せず **read-only で正直に停止する**
  （`validate-recipe.mjs` 実装。§7）
- フィールド命名は **snake_case**

## 1. 確定スキーマ

正本: `packages/schemas/recipe.schema.json`（`$id: urn:akari-video:schema:recipe:v0`）。
実例: `packages/schemas/examples/recipe-v0-sample/<name>.json`。

```jsonc
{
  "version": 0,
  "name": "product-demo-quick-cuts",
  "frozen_at": "2026-07-25T10:00:00.000Z",
  "source_project": "acme-product-launch-2026-07-20",
  "workflow": "edit",
  "confirmed": {
    "aspect": "16:9",
    "target_duration_band": "30-60s",
    "caption_style_ref": "lower-third-clean",
    "bgm_profile": "corporate-upbeat",
    "overlay_kinds": ["telop", "3d"],
    "narration": { "engine": "voicevox", "voice": "zundamon" }
  },
  "provenance": {
    "aspect": { "confirmed_by": "render-approval", "at": "2026-07-20T08:00:00.000Z" },
    "target_duration_band": { "confirmed_by": "intake", "at": "2026-07-20T02:00:00.000Z" },
    "caption_style_ref": { "confirmed_by": "edit-approval", "at": "2026-07-20T05:00:00.000Z" },
    "bgm_profile": { "confirmed_by": "edit-approval", "at": "2026-07-20T05:00:00.000Z" },
    "overlay_kinds": { "confirmed_by": "edit-approval", "at": "2026-07-20T05:00:00.000Z" },
    "narration": { "confirmed_by": "edit-approval", "at": "2026-07-20T05:00:00.000Z" }
  }
}
```

### フィールド表

| フィールド | 型 | 必須 | 単位・備考 |
|---|---|---|---|
| `version` | integer (const 0) | 要 | — |
| `name` | string | 要 | kebab-case。呼び出し名（§4 の「<名前>でもう一本」の対象）。`~/.akari/recipes/<name>.json` のファイル名と一致させる |
| `frozen_at` | string (ISO8601) | 要 | 凍結（freeze 実行）時刻 |
| `source_project` | string | 要 | プロジェクト名 + 日付の自由記述（例 `acme-product-launch-2026-07-20`）。**パスは書かない** — プロジェクトの移動・削除で壊れる参照を持たないため（§6） |
| `workflow` | enum | 要 | `edit`（`skills/edit-plan` の選好）/ `research`（`skills/research-plan` の選好） |
| `confirmed` | object | 要（最低 1 フィールド） | **確認済み選好のみ**。全フィールド任意・null 不可（確認されていない項目はキー自体を書かない。§3 規律 1） |
| `confirmed.aspect` | enum | 任意 | `16:9` / `9:16` / `1:1`（既存カタログタグの慣用値。`catalog/3d/vintage-camera/meta.json` 等の `tags[]` に既出。§6） |
| `confirmed.target_duration_band` | string | 任意 | 尺そのものではなく帯（例 `30-60s`）。素材が変われば正確な秒数は転用できないため帯で記録する（§6） |
| `confirmed.caption_style_ref` | string | 任意 | 字幕スタイルの参照名（カタログの telop プリセット名、または字幕方針を指す自由記述） |
| `confirmed.bgm_profile` | string | 任意 | BGM の選好を指す自由記述（ジャンル・ムード・カタログ候補名等） |
| `confirmed.overlay_kinds[]` | string[] | 任意 | 重複なし・最低 1 件。`skills/overlay-authoring/*.md` の kind 名（`telop`/`3d`/`table`/`motion`/`text-behind-person`/`thumbnail` 等）を目安にするが enum 強制はしない（overlay-authoring の追加に追従できるように。§6） |
| `confirmed.narration` | object | 任意（最低 1 フィールド） | `engine`・`voice`（ともに任意・null 不可）。`edit.schema.json` の `narrationProvenance.engine`/`voice` と同じ自由記述語彙（enum 強制なし） |
| `provenance` | object | 要（最低 1 フィールド） | `confirmed` に実在するキーと**過不足なく 1 対 1 対応**する。各エントリは `{ confirmed_by, at }` |
| `provenance.<field>.confirmed_by` | enum | 要 | `intake` / `structure-confirm` / `edit-approval` / `render-approval`（§4 の対応） |
| `provenance.<field>.at` | string (ISO8601) | 要 | 確認された時刻 |

「要（最低 1 フィールド）」= キー自体は必須だが、中身が空の object（何も確認していない）は
認めない。`confirmed` が空なら、そもそも freeze する理由がない（§3 規律 1・3）。

## 2. 置き場所

> 2026-07-25 第三裁定により `~/.akari/recipes/` のまま確定（asset-library.md 末尾の裁定履歴参照。Akari-OS 全廃止前提）

**`~/.akari/recipes/<name>.json`**（プロジェクト横断の個人層。**オーナー裁定事項** — 本契約が
新設する唯一のプロジェクト外置き場所）。

- 名前は **kebab-case**。1 レシピ = 1 ファイル
- プロジェクト内（`planning/` 等）には置かない。レシピはプロジェクトをまたいで呼び出される
  ものであり、特定プロジェクトのライフサイクルに従属させない（`plan-comments.json` とは対照的な
  設計 — あちらは 1 プロジェクト 1 ファイルの一時伝票、こちらは個人層の永続台帳）
- 本タスクの検証は**リポ内 fixture で完結させ、実際の `~/.akari/recipes/` へは書き込まない**
  （タスク制約）。スキル側の実運用でこのディレクトリへ書く際は、存在しなければ作成してよい

## 3. データ規律 — HyperFrames recipe freeze / remembered defaults の輸入

1. **確認済みの値だけ記録する**。推測やデフォルト採用で埋まった値は記録しない
   （ユーザーが推奨を見て受け入れた = 確認とみなす）。`confirmed` に書いてよいのは、
   人間が明示承認したチェックポイントを通過した値だけである
2. 記憶された値は**出所を名乗る推奨**として提示する。現在の依頼を**上書きしない**。
   スキルは必須質問（intake の進め方フォーム等）を**スキップさせない** — レシピは
   「前回はこうでした」という参考情報であり、承認ゲートの代替ではない
3. レシピ（承認された一式の凍結）だけは別格: 採用の宣言（「<名前>でもう一本」「前回と同じで」）
   自体が確認なので、`confirmed` に含まれるフィールドを一括で埋めてよい
4. **freeze の提案は納品時に一度だけ**（offer-once）。同一プロジェクト内で繰り返し
   凍結を提案しない。凍結できたら、呼び出し方まで教える確認文を人間に返す:

   > **<名前>** として保存。次回は『<名前>でもう一本』か『前回と同じで』

   名前はシステムが思い出させるものであり、ユーザーが暗記するものではない
   （recall 手順は名前を尋ねず `~/.akari/recipes/` を列挙して提示する。§4）
5. **初回記録時**（そのプロジェクトで初めてレシピを freeze する時）に「今後のために記憶する」旨を
   一言、人間に通知する

## 4. スキル配線と `confirmed_by` の対応

| `confirmed_by` | 発生するチェックポイント | 対象スキル |
|---|---|---|
| `intake` | 進め方フォーム（`intake.json` 提出） | 全ワークフロー共通の入口 |
| `structure-confirm` | 企画構成の確定決定カード | `skills/research-plan`（`workflow: "research"`） |
| `edit-approval` | Checkpoint 1（方針）/ Checkpoint 2（素材計画） | `skills/edit-plan` |
| `render-approval` | Checkpoint 3（実行 manifest） | `skills/edit-plan`（実行段の確定値。出力 aspect 等） |

freeze / recall の実手順は [skills/edit-plan/recipe.md](../skills/edit-plan/recipe.md) が正本。
`skills/edit-plan/SKILL.md` と `workflow.md` は方針決めの前段に recall を、完了処理に
freeze の offer-once を、それぞれ数行で組み込み recipe.md へリンクする。
`skills/research-plan/SKILL.md` と `ideate.md` はネタ出し・企画の冒頭で `workflow: "research"`
レシピの recall を同じ規律で行い、recipe.md の recall 手順を参照する
（`research-plan` 専用の freeze leaf は本契約のスコープ外 — 現状 freeze の実装は
`skills/edit-plan/recipe.md` のみ。research 側の freeze は次段で検討する。§9）。

## 5. 劣化規約

`recipe.json` は個人層の参考情報であり、検証失敗が編集・企画工程を巻き込んで失敗させない。

| 状況 | 挙動 |
|---|---|
| `~/.akari/recipes/` が存在しない、または空 | 正当な状態。recall する対象がないだけで error にしない |
| `workflow` が一致するレシピが無い | 推奨候補なしとして通常フローを続行する |
| `confirmed` が空、または `provenance` とキーが不一致 | スキーマ検証エラー（読み手は使わない。§1） |
| `version > 0` | read-only で正直に停止する（原則 3。`validate-recipe.mjs` 実装） |
| レシピ採用後に今回の依頼と矛盾する指示が来た | 人間の直近の明示指示が常に優先する（`plan-comments.json` §3-6 と同型の優先順位） |

## 6. データ設計意図

- **`source_project` にパスを書かない理由**: プロジェクトディレクトリは移動・削除されうる。
  レシピは個人層でプロジェクトをまたいで生き続けるため、壊れる参照を持たせない
  （名前 + 日付の自由記述のみ。「このレシピがどのプロジェクトの経験から来たか」を人間が
  読める記録として残すだけで、機械的な参照解決はしない）
- **`target_duration_band` が秒ではなく帯である理由**: `plan.schema.json` の
  `slots[].target_duration_seconds` や `intake.schema.json` の `target.duration_s` は
  「このプロジェクトの」厳密な尺だが、レシピは別プロジェクトへの転用が前提。次の素材の
  尺は前回と同じにはならないため、厳密な秒数ではなく「30-60s」のような帯で好みを記録する
- **`aspect` の enum が `16:9`/`9:16`/`1:1` の 3 値である理由**: 新しい語彙を作らず、
  `catalog/3d/vintage-camera/meta.json` 等で既に使われているタグ慣用値をそのまま採用した
  （`edit.schema.json` の `render.master` は width/height の実数で持つが、レシピは
  「次はどの向きで作るか」という選好であり、具体的な解像度ではなく比率のカテゴリで十分）
- **`overlay_kinds[]` を enum で縛らない理由**: `skills/overlay-authoring/` 配下のリーフは
  今後も増える（`beats.md`/`emphasis-detection.md` 等、edit-plan 側の表現手段選定は既に
  カタログ駆動で拡張可能な設計になっている）。レシピ側で enum を固定すると、新しい
  overlay kind が増えるたびに本契約を改訂する結合が生まれるため、自由文字列の配列とする
- **`narration.engine`/`voice` を enum で縛らない理由**: `edit.schema.json` の
  `narrationProvenance.provider`/`engine`/`voice` が既に「契約文書で例示するのみで enum
  強制はしない」設計になっている（voicevox/fal/elevenlabs/human 等）。レシピもこの既存の
  緩さに揃える
- **`provenance` をフィールド単位で持つ理由**: 1 つのレシピの中でも、`aspect` は実行承認
  （render-approval）で確定し、`target_duration_band` は intake で確定する、というように
  確認された瞬間はフィールドごとに異なる。ファイル全体で 1 つの `confirmed_by` を持たせると
  この粒度が失われる
- **状態を持たない理由**: `recipe.json` は凍結された断面（スナップショット）であり、
  `plan.json` の `confidence` のような進行中の状態梯子は持たない。凍結後にレシピの中身が
  「進行」することはない（再 freeze で別の断面に置き換わるだけ）
- **学習・自動適用をしない理由**: v0 は「記録」と「出所付きの推奨提示」のみに限定する
  ことで、確認ゲートを迂回する自動化を作らない（§0・§3 規律 2）。学習・スコアリングは
  人間の意図しない適用を生みやすく、本契約のスコープでは扱わない（§9）

## 7. よくある間違い

- **推測やデフォルト採用の値を `confirmed` に書く** — 誤り。§3 規律 1。人間が明示承認した
  値だけが確認済みである
- **レシピの推奨値で今回の依頼を上書きする、または必須質問をスキップする** — 誤り。
  §3 規律 2。レシピは参考情報であり承認ゲートの代替ではない
- **同一プロジェクトで freeze を何度も提案する** — 誤り。§3 規律 4。offer-once
- **`confirmed` に値はあるが `provenance` に対応エントリが無い（またはその逆）** — 誤り。
  §1。1 対 1 対応が崩れている状態は検証エラー
- **`~/.akari/recipes/` 以外の場所（プロジェクト内等）にレシピを置く** — 誤り。§2。
  置き場所は本契約が定める 1 箇所のみ
- **`target_duration_band` に前回プロジェクトの厳密な秒数をそのまま書く** — 誤り。§6。
  レシピは転用前提のため帯で記録する
- **レシピの採用宣言なしに `confirmed` の値を無言で今回の計画へ流用する** — 誤り。§3 規律 3。
  一括充填が許されるのはレシピ採用の明示宣言があったときだけ

## 8. マイグレーション

（空欄 — `version` bump は発生していない。bump する場合はここに旧→新の機械実行可能な
変換手順を必ず併記する。`contract-2026-07-17` 原則 2）

## 9. 次段（本契約のスコープ外）

- 学習・自動適用・スコアリング（本契約は記録と出所付き提示のみ。§0）
- レシピの GUI（一覧・編集・削除の専用ビューワー）
- `~/.akari/recipes/` 以外の置き場所（プロジェクト内レシピ、チーム共有レシピ等）
- `research-plan` 専用の freeze leaf（現状 freeze の実装導線は `skills/edit-plan/recipe.md` の
  みで、research 側は recall のみを行う。research 成果物からの freeze 手順は次段で検討する）
- `edit.json` / `intake.json` / `research-plan.json` 本体スキーマへの変更（本契約は
  `recipe.json` 単体の新設のみ）
- レシピ間の継承・差分マージ（複数レシピを組み合わせる機構は非スコープ）
