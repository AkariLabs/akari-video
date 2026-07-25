# plan.json v0（仮枠タイムライン）契約

- 日付: 2026-07-20
- 状態: 実装ラウンドの SSOT（データ形と検証のみ確定。仮枠コンパイラは §6 の規約先行・実装は次段）
- 前提: 仮枠タイムラインの方向性メモ §3〜§5（本契約はこの節群を昇格したもの。
  メモ原本は非公開の内部記録で管理）、`contract-2026-07-17-data-contract-versioning.md`（三原則）、
  `contract-2026-07-18-edit-json-v1-sources.md`（§2 の連結規則と §6 のコンパイル先）、
  `contract-2026-07-13-m5-analysis-report.md`（編集判断レポート = 本データのもう 1 つのレンダリング）
- スコープ: `plan.json` のデータ形・検証・置き場所・edit.json への接続規約。
  対話 UI・ゴースト描画・コンパイラ実装・収録統合は扱わない（§11 次段）
- 名前について: `packages/render-cut/src/plan.mjs` は非永続の ffmpeg コマンド計画
  ビルダーであり本契約とは無関係（純粋な語彙の重なり）。`skills/edit-plan` は
  編集判断レポートのスキル名で、§5 のとおり本データと収束していく関係にある

## 0. version 運用

- 新設契約のため `contract-2026-07-17` §4 のチェックリストを初版から適用する:
  トップレベル `version` は**整数・0 起算**。進化は**追加のみ**、読み手は**寛容リーダー**
  （`additionalProperties: true`。未知フィールドは保持し、欠落は既定値で補う）
- 既知より大きい `version` を見た読み手は推測変換せず read-only で正直に停止する
  （`validate-plan.mjs` 実装済み）
- 旧世代スキーマ（analysis / connections / asset-meta）の `additionalProperties: false` とは
  **意図的に違える**。あちらは版管理契約より前の設計であり、本契約は版管理契約準拠の
  新しい先例（edit.schema.json と同側）に揃える
- フィールド命名は **snake_case**（`.schema.json` を持つ契約群 connections / asset-meta /
  analysis の先例）。review.json（camelCase）は既存資産のため命名系が分かれるが、
  「schema ファースト契約 = snake_case、既存 TS 資産由来 = camelCase」という分裂として
  両契約に明記して固定する

## 1. 確定スキーマ

正本: `packages/schemas/plan.schema.json`（`$id: urn:akari-video:schema:plan:v0`）。
実例: `packages/schemas/examples/plan-v0-sample/plan.json`。
置き場所: **編集判断レポートと同じ `<plan-dir>`**（AKARI プロジェクトでは `planning/`
ロールが既定。workflow.md §1 の出力先規約に従う）。相対パスはすべて **plan.json
所在ディレクトリ基準**（edit.json のパス解決規則と同型）。

```jsonc
{
  "version": 0,
  "slots": [
    {
      "id": "s-opening",
      "label": "オープニング",                    // 人間可読のビート名（レポート・タイムライン両表示で使う）
      "script": "こんにちは。今日は…",            // テレプロンプター台本 兼 TTS 仮ナレ原稿。null 可
      "target_duration_seconds": 5.0,
      "confidence": "proposed",                  // "proposed" | "locked" | "filled"（§3）
      "fill": {                                  // 充填手段（§4）
        "method": "generate",                    // null | "generate" | "record" | "import"（null = 未決）
        "prompt": "明るいデスクの俯瞰…",          // generate 用。null 可
        "asset_path": null                       // import 用。copy-don't-link 後の相対パス
      },
      "media": {                                 // 現在のスタンドイン（仮枠の実体）
        "image_path": "scaffold/beat-01.png",    // 静止画。null 可
        "audio_path": "scaffold/beat-01.wav",    // TTS 音声。null 可
        "text_card": null                        // タイポグラフィのみのビート用。null 可
      },
      "provenance": { "tool": "codex-image", "created_at": "2026-07-20T11:00:00.000Z", "note": "…" }
    }
  ],
  "constraints": [
    { "id": "c-total", "kind": "duration_exact", "applies_to": null, "value": 30.0, "note": "30 秒尺で確定" },
    { "id": "c-sfx",   "kind": "note",           "applies_to": "s-main", "value": null, "note": "冒頭にボン系の SFX" }
  ]
}
```

### フィールド表

| フィールド | 型 | 必須 | 既定値 | 単位・座標系 |
|---|---|---|---|---|
| `version` | integer (const 0) | 要 | — | — |
| `slots[]` | array | 否 | []（対話開始直後は空で正当） | 配列順が timeline 順（§2） |
| `slots[].id` | string | 要 | — | plan 内一意 |
| `slots[].label` | string | 要 | — | — |
| `slots[].script` | string \| null | 要（キー） | null | テレプロンプター / TTS の正本（§4 record） |
| `slots[].target_duration_seconds` | number > 0 | 要 | — | 秒 |
| `slots[].confidence` | enum | 要 | — | `proposed` / `locked` / `filled`（§3） |
| `slots[].fill.method` | enum \| null | 要（キー） | null = 未決 | `generate` / `record` / `import`（§4） |
| `slots[].fill.prompt` | string \| null | 否 | null | generate 用 |
| `slots[].fill.asset_path` | string \| null | 否 | null | import 用。plan.json 基準の相対パス |
| `slots[].media.*` | string \| null | 要（キー） | null | `image_path` / `audio_path` は plan.json 基準の相対パス |
| `slots[].provenance.*` | — | 要（キー） | null | `tool` / `created_at`（ISO-8601）/ `note` |
| `constraints[]` | array | 否 | [] | — |
| `constraints[].kind` | enum | 要 | — | `duration_max`（ハード上限）/ `duration_exact`（目標尺）/ `note`（非構造 locked 指示） |
| `constraints[].applies_to` | string \| null | 要（キー） | null = プロジェクト全体 | slot id 参照 |
| `constraints[].value` | number > 0 \| null | 要（キー） | — | duration_* では必須（秒）。note では null |

「要（キー）」= 値は null 許容だがキーは省略しない（`sourceV1.proxy` と同じ流儀。
レコード単体で自己記述的になる）。

## 2. タイムライン導出規則 — start を永続化しない

**timeline は `slots[]` を配列順にギャップなく連結して導出する。** 各 slot の開始時刻は
`前の slot までの target_duration_seconds の総和`であり、`start` フィールドは持たない。
edit.json v1 の「cuts[] を配列順にギャップなく連結」（contract-2026-07-18 §2）と同型の
規則を 1 段上流に適用したもの。並べ替えのたびにズレる冗長フィールドを持たないことで、
スロットの入れ替え = 配列の並べ替えだけで完結する。

「尺 30 秒のケツ」のような境界の確定は slot の中身ではなく **constraints** で表す
（`applies_to: null` の `duration_exact` / `duration_max`）。「正解のないタイムライン」の
うち、決まっている事実だけを制約として分離し、仮説（slots の並びと尺）と混ぜない。

## 3. confidence 状態遷移

`confidence` は**保存フィールド**であり、`media` の有無から導出しない（locked かつ未充填
= 「空きスロットだが方向は確定」は正当な状態。ここが導出だと収録前ロックが表現できない）。

| 状態 | 意味 | 表示（次段の UI 規約） |
|---|---|---|
| `proposed` | AI の仮説 | ゴースト表示（点線・半透明） |
| `locked` | 人間が確定（決定カード commit / 明示承認） | 固定表示 |
| `filled` | 実素材が入った | 通常表示 |

推奨遷移（散文規約。スキーマでは強制しない）: `proposed` →（人間の承認）→ `locked` →
（§4 の充填実行）→ `filled`。人間の明示要求があれば逆遷移（filled → locked / proposed）も
可。整合の乱れ（filled なのに media 全 null、proposed 以外で fill.method 未決）は
**warning**（検証は止めない）。

## 4. fill — スロットの充填手段

空きスロットはプラン由来の `script` と `target_duration_seconds` を既に知っている。
充填手段は 3 種 + 未決:

- `null`（未決）: 対話中の正当な状態。proposed スロットの既定
- `generate`: AI 生成。**画像先行**（`media.image_path` に 1 枚目の絵 → 仮枠 QA →
  承認後に動画生成）。`prompt` は生成前は AI 仮説、実行時に実際に使った値へ更新してよい
  （provenance は「手・日時」、fill は「何を・どう」という分担で、prompt の二重管理をしない）
- `record`: 画面/カメラ収録。テレプロンプターは `slot.script` を直接読む（複製フィールドを
  持たない）。takes[] / device 等の収録詳細は v1+ の追加フィールドとして予約
- `import`: 既存素材の割り当て。`asset_path` は素材ライブラリの copy-don't-link 規律を
  経た後の**プロジェクト内実体パス**（ライブラリ層参照を plan に持ち込まない）

## 5. スコープ境界 — 素材三択は M5 のまま

plan.json v0 が持つのは**シーケンシャルな骨格（slots）と構造制約（constraints）だけ**。
BGM・字幕方針・SFX・B ロール・テロップ様式の「あれば提案 / なければ生成 / だめなら
使わない」の三択は、従来どおり編集判断レポート §5 素材計画（contract-2026-07-13-m5）の
管轄であり、plan.json に持ち込まない。「ここに効果音が欲しい」のような位置つき指示は
`constraints[].kind: note` で locked な**指示**として運び、素材の選定・生成判断そのものは
M5 側で行う。

レポートと plan.json の関係: **同一プランの 2 つのレンダリング**（メモ §4）。当面は
plan.json が骨格の SSOT、レポートは plan.json の slot id を根拠参照する
（report-guide.md の追記参照）。レポート生成フロー全体の plan.json 駆動化は次段。

decision-cards との関係は疎結合: 方針決めの質問対話は既存機構の別ペア
`<plan-dir>/plan-dialogue.html` + `.decisions.json` で行い（コード変更不要）、確定結果を
plan.json に書く。plan.json 自体は decision id を持たない（`decision_ref` は v1+ の
追加候補として予約）。

## 6. プレビュー合成規約 — 普通の edit.json v1 へコンパイルする

仮枠の再生（アニマティクス QA）は専用レンダラーを作らず、**通常の edit.json v1 への
コンパイル**で実現する。プレビュー・edit-lint・render-cut が無改造でそのまま使えることが
本規約の眼目であり、**edit.json に新しい語彙を 1 つも足さない**。

- 各 slot は 1 本の**通常のソース素材**にベイクされる: `media.image_path` を
  `target_duration_seconds` ぶんループし `media.audio_path`（TTS）を重ねて ffmpeg で
  1 クリップ化 → `sources[]` に登録、`cuts[]` が配列順に並ぶ。`text_card` のみの slot は
  無地背景ソース + 既存 overlay 規約（単一ルート・`data-start`/`data-duration`）の
  HTML 断片にコンパイルする
- 配置: `<plan-dir>/scaffold/` に `edit.json` / `sources/` / `overlays/` / `manifest.json`。
  `manifest.json` は slot ↔ コンパイル産物の対応
  `{ version, plan_ref, plan_hash（plan.json テキストの sha256）, compiled_at,
  slots: [{ slot_id, source_id, cut_index, overlay_id|null }] }` を持つ
  （本ラウンドでは文書化のみ・schema 化しない）
- 再生成規則: **常に全再構築**。部分パッチはしない（仮枠素材は安価であることが仮枠の
  存在意義であり、並べ替え後の対応追跡という難problemを持ち込まない）。`plan_hash` の
  一致で無変更時の再コンパイルをスキップしてよい
- コンパイル済み scaffold/edit.json は**それ単体で自己完結**する（plan.json を知らない
  エンジニアがそのままプレビュー・lint・書き出しできる）。edit.json 契約の自己完結原則を
  文字どおり満たす
- 注意: `skills/edit-plan` のハードルール「edit.json は v0 単一 source 形を変えない」は
  **edit-plan フローの最終成果物**に対する規定であり、本 scaffold は別成果物。ただし
  同ルールが v1 sources 契約（2026-07-18）より古い記述のままである点はオーナー判断の
  持ち越し事項として開示する（本契約では変更しない）
- **コンパイラの実装は本ラウンドのスコープ外**（規約のみ確定）

## 7. 劣化規約

plan は企画データであり、検証・表示・下流工程の全体を巻き込んで失敗させない。

| 状況 | 挙動 |
|---|---|
| `slots` / `constraints` が無い | 空として扱う（対話開始直後の plan として正当） |
| `media.*` / `fill.asset_path` の実体ファイルが無い | validate-plan は error（充填記録の虚偽を許さない）。表示側は当該 slot を未充填として描画し他を巻き込まない |
| `confidence: filled` なのに media 全 null | warning（§3。検証は止めない） |
| `proposed` 以外で `fill.method: null` | warning |
| `duration_max` 超過 | **error**（ハード上限。locked な事実に反する plan を通さない） |
| `duration_exact` と slot 合計の乖離 | **warning**（目標尺への収束は仮枠 QA の過程そのもの） |
| `constraints[].applies_to` が存在しない slot を指す | error（参照切れ） |
| `version > 0` | read-only で正直に停止（原則 3） |

## 8. データ設計意図

- **slots と constraints を分けた理由**: 「たぶんこう並ぶ」（仮説の列）と「これは決まって
  いる」（事実）は寿命も所有者も違う。混ぜると §2 の「正解のないタイムライン」問題が
  データに逆流する
- **`start` を持たない理由**: §2。冗長座標は必ずズレる（timelineT の教訓を上流で繰り返さない）
- **`media` が fill と別である理由**: `media` は「今の見た目（スタンドイン）」、`fill` は
  「最終的にどう埋めるか」。generate 予定 slot が仮枠段階で静止画スタンドインを持つ、が
  自然に表現できる
- **キー必須・値 null 許容の流儀**: レコードを読むだけで契約の全フィールドが見える
  （AI が plan.json を直接書く際のセルフドキュメント。sourceV1.proxy の先例）

## 9. よくある間違い

- **slot に `start` や timeline 秒を書き足す** — 誤り。位置は配列順 + 尺から導出（§2）
- **「30 秒で終わる」を最後の slot の尺で表現する** — 誤り。`constraints` の
  `duration_exact` / `duration_max`（`applies_to: null`）で表す
- **BGM・SFX の素材選定を plan.json に持ち込む** — 誤り。§5。位置つき指示は
  `kind: note` まで
- **`filled` を「media が非 null」から導出する** — 誤り。confidence は保存フィールド（§3）
- **record 用に台本フィールドを複製する** — 誤り。テレプロンプターは `slot.script` を読む
- **scaffold/edit.json を手で直す** — 誤り。§6 の全再構築規則により次のコンパイルで消える。
  直すのは plan.json（または通常の編集フローに進んでから edit.json 本体）
- **`plan.mjs`（render-cut）と混同する** — 別物（ヘッダ注記）

## 10. マイグレーション

（空欄 — `version` bump は発生していない。bump する場合はここに旧→新の機械実行可能な
変換手順を必ず併記する。`contract-2026-07-17` 原則 2）

## 11. 次段（本契約のスコープ外）

- 仮枠コンパイラ実装（§6 の規約に従う。画像生成/TTS の実行・ffmpeg ベイク・manifest 生成）
- 質問対話 UI の充実（当面は decision-cards の既存機構で代替。skills/edit-plan/plan-json.md 参照）
- タイムラインのゴースト描画（confidence 別表示。akari-annotations の strip 描画へ統合）
- 収録統合（`fill.record` の takes[] / device / テレプロンプター UI）
- `decision_ref` フィールド（decision-cards との追跡強化）
- edit-lint の plan.json / manifest.json 横断検査（コンパイラ実装後）
- 編集判断レポートの plan.json 駆動レンダリング化（§5 の収束の完成形）
