# レビューセッション UI イベント（events.jsonl 拡張 + 記録中インジケータ）契約

- 日付: 2026-08-11
- 状態: 実装ラウンドの SSOT（events.jsonl の追加イベント形・target 語彙・インジケータ挙動を確定）
- 前提: `contract-2026-07-20-review-json-v1-annotation-model.md`（review.json v1・寛容リーダー三原則）、
  レビューセッション記録（`review/sessions/s-XXXX/` = audio.wav + events.jsonl + strokes.json +
  edit.snapshot.json。実装: `apps/shell/extensions/akari-preview/src/node/review-session-writer.ts`）。
  判断根拠のメモ原本は非公開の内部記録で管理（doc-image-annotations / canvas-surface と同方式）
- スコープ: 記録セッション中の **UI イベント（受動記録）** と**記録中インジケータ**、および
  ツールモードイベントの**語彙予約**。review.json 側の `ui:` target の着地（注釈レコード化）は
  次段の実装契約で確定する（§6 予約のみ）

## 0. version 運用（後方互換）

- `session.json` の manifest `version: 1` は据え置く。本契約の追加はすべて events.jsonl の
  **新規イベント type の追加**であり、既存イベント（`start` / トランスポート系）の形は変えない
- 読み手（compile-review-session 等）は**未知の type を無視して処理を続行する**こと（寛容
  リーダー）。既存セッションに新イベントが無いのは正常（欠落 = その情報なし）
- `review-session-writer.ts` の `appendEvent` は `recT` 検証のみの汎用追記であり変更不要。
  本契約の実装は**発行側（browser）**に閉じる

## 1. 追加イベント形（正本）

すべて 1 行 1 JSON（JSONL）。`recT` = 録音開始からの経過秒（既存イベントと同一基準）。

| type | 形 | 発火条件 | 段 |
|---|---|---|---|
| `ui.click` | `{recT, type: "ui.click", target, label, intent?}` | 登録済み UI 要素（§2）へのクリック | M1 |
| `ui.tab` | `{recT, type: "ui.tab", target, label}` | アクティブタブの変化 | M1 |
| `ui.panel` | `{recT, type: "ui.panel", target, label}` | アクティブパネルの変化（フォーカス移動） | M1 |
| `tool.mode` | `{recT, type: "tool.mode", mode}` | 注釈ツールモードの切替 | M2（語彙のみ本契約で予約） |

- `target`: §2 の語彙に従う安定 id 文字列。必須
- `label`: 人間可読名（例: `"素材パネル"`）。必須。文字起こしとの突合で発話中の呼称と
  照合するために使う（id だけでは「左上の素材パネル」という発話と結べない）
- `intent`: 任意 boolean。選択ツール（M2）が有効なときのクリックにのみ `true` を付ける。
  省略 = 受動記録（意図マーカーなし）
- `mode`: `"neutral" | "pen" | "rect" | "select"`。M2 実装まで発行されない（予約）

## 2. target 語彙 v1

**クリックした要素だけを記録する。全 DOM 追跡はしない。**

| 形 | 意味 | 例 |
|---|---|---|
| `panel:<id>` | シェルの主要パネル | `panel:assets` / `panel:inspector` / `panel:review` / `panel:timeline` |
| `tab:<id>` | タブ | `tab:assets-builtin` |
| `timeline:cut:<n>` | タイムラインのカット（cuts[] index） | `timeline:cut:3` |
| `timeline:overlay:<id>` | タイムラインのオーバーレイ | `timeline:overlay:o-0002` |
| `asset:<path>` | 素材（プロジェクト相対 or カタログ id） | `asset:assets/broll/city.mp4` |
| `asset:<category>/<id>` | 素材（カタログ由来カード。key = `<category>/<id>`） | `asset:still/br-typing-laptop` |

- **登録機構**: 記録対象の要素は `data-akari-ui="<target-id>"` 属性で opt-in する。
  クリック解決は capture-phase のリスナー 1 本で行い、**最近傍の登録済み祖先**に丸める。
  登録要素の外のクリックはイベントを発行しない
- 語彙の追加は additive（新しい `<prefix>:` を足すのは自由。既存の意味変更は禁止）
- `label` は属性 or 登録側が供給する（DOM テキストの機械抽出に頼らない）

## 3. 発火条件

- UI イベントの記録は**レビューセッション記録中のみ**。セッション外では リスナー自体を
  外すか no-op にする（常時監視をしない）
- 発行は既存の `appendEvent` RPC 経由。順序は発行順（recT 単調増加は既存規約どおり）

## 4. 記録中インジケータ

- セッション記録中、**レビュー（注釈）パネルを除く画面全体をオレンジ系の枠で囲う**。
  グロー（にじみ）のかかった質感。画面収録の「録画中」の視覚言語に寄せる
- 実装は `pointer-events: none` のオーバーレイ。**クリック・操作を一切奪わない**
- 点滅アニメーションはしない（緩やかな明滅までは実装裁量）。受け入れ基準 =
  「一目で記録中と分かるが、作業の邪魔をしない」
- 表示はセッション開始と同時、非表示は終了と同時。録音ボタンの状態と常に一致すること

## 5. 検証

- L0: 既存テスト全件 + ビルド
- 発行側の単体テスト: 登録要素クリック → 期待形のイベント / 未登録要素 → 発行なし /
  セッション外 → 発行なし
- 実機: 記録開始 → 素材パネルクリック → タブ切替 → 終了、で events.jsonl に該当行が
  recT 順で入ることを実測。インジケータはスクリーンショットで証跡
- 回帰: 新イベント入りの events.jsonl を旧読み手（compile-review-session の手順）が
  処理してもエラーにならないこと

## 6. 予約（次段の実装契約で確定）

- review.json `annotations[].target` への **`ui:<element-id>`** 追加（選択ツール経由の
  UI 要素注釈の着地形）。§2 と同一の id 空間を使う
- 書き出し済み MP4 への注釈は新 target 種を作らず既存 `src` 機構で扱う方針（要検証:
  プロジェクト外ファイルの src 正規化）
- 音への注釈（`sourceRange` + トラック指定）の形
