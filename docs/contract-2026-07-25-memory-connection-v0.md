# memory connection v0（外部参照記憶の接続宣言）契約

- 日付: 2026-07-25
- 状態: **ドラフト・要オーナーレビュー**（データ契約の新設はオーナー裁定事項。本書はレビュー前提の起草）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（三原則の正本）、
  `contract-2026-07-25-recipe-v0.md`（直前の姉妹契約。文体・様式・ドラフト明記の先例）、
  `packages/schemas/connections.schema.json`（拡張対象の現行形。`providers`/`policy` の
  $defs の流儀を継承する）
- 発端: オーナー対話（2026-07-25）。要旨: プロジェクトを事業 Wiki の中に入れるのは違うが
  同期は要る／事業 Wiki は規模が大きすぎる（売上等は要らない）／外部参照させる記憶と
  好み・スタイルの記憶は分けたい。内部裁定の全文脈は内部リポ（akari-video-internal）の
  memory-and-style 契約 §0-§1 を正本とする（本書は同裁定のうち
  **系統 A = 外部参照記憶**だけを公開契約化する。**系統 B = スタイルプロファイル**は別契約）
- スコープ: `.akari/connections.json` への `memory` 接続タイプ追加（スキーマ・データ規律・
  読む瞬間の規約）のみ。**書き戻し・リモートソース・インストール時デフォルト・intake
  スキーマ変更・スタイル記憶は扱わない**（§9）

## 0. 位置づけ — 格納ではなく接続宣言

本契約は「動画プロジェクトが記憶を保持する」仕組みではない。**プロジェクトが「どの外部知識
（事業 Wiki 等）を記憶として読むか」を `.akari/connections.json` の `memory` 宣言として
表明し、決まった読む瞬間（§4）にスキルがそこを読み、参照した記憶ファイルを出所として
記録するだけ**のファイル契約 + スキル規律である。

- 記憶ソースの本体（Wiki）はプロジェクトの外に留まる。動画プロジェクトの中へコピー・
  格納しない
- IPC・常駐サーバは持たない。読み取りはスキルがファイルシステムを直接読むだけ
- v0 は**読み取り専用**（`read_policy: "read-only"` 固定）。書き戻し（完了時の要点サマリを
  記憶ソースへ書く動作）は次段（§9）

版管理三原則（`contract-2026-07-17` §2）は、本契約が拡張する `connections.schema.json` 自体が
トップレベル `version` フィールドを持たない既存スキーマであるため、次のとおり適用する:

- **追加のみ進化**: `memory` はトップレベルの任意フィールドとして追加する。既存の
  `providers`/`policy` の型・意味は変更しない。既存 connections.json（`memory` 無し）は
  従来どおり valid のまま（受け入れ条件で実測する）
- **寛容リーダー**: `memory` を持たない connections.json は「読む記憶が無い」正当な状態
  として扱う（error にしない。§5）
- **snake_case**: 新設フィールドはすべて snake_case（`root`/`entry`/`include`/`exclude`/
  `read_policy`）
- **原則 3（正直に停止する）の適用範囲**: `connections.schema.json` に整数 `version` が
  無いため、本契約は破壊的変更時の bump 契約を新たに持たない。将来 `memory` に破壊的変更が
  必要になった時点で、`connections.schema.json` 全体への `version` 導入を別途検討する
  （本契約の非スコープ。§9）

## 1. 確定スキーマ

正本: `packages/schemas/connections.schema.json`（`$id: urn:akari-video:schema:connections:v0`。
既存 `$id` は変更しない — 追加のみの進化であり破壊的変更ではないため）。実例:
`packages/schemas/examples/connections-v0-memory-valid/connections.json`。

```jsonc
{
  "providers": [ /* 既存どおり */ ],
  "policy": { /* 既存どおり */ },
  "memory": [
    {
      "name": "kyo-kobo-wiki",
      "root": "~/_edit",
      "entry": "INDEX.md",
      "include": ["05_kyo-kobo/**", "30_products/**"],
      "exclude": ["10_accounting/**"],
      "read_policy": "read-only"
    }
  ]
}
```

### フィールド表

| フィールド | 型 | 必須 | 単位・備考 |
|---|---|---|---|
| `memory[]` | array | 任意（トップレベル） | 省略可。既存 connections.json（`memory` キー無し）は従来どおり valid |
| `memory[].name` | string | 要 | kebab-case（`providers[].id` と同じ pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`）。呼び名。配列内で重複不可 |
| `memory[].root` | string | 要 | 記憶ソースのルートパス（空でない文字列。ローカルパスのみ — v0 はリモートソース非対応）。`~` 展開は読み手（スキル側）の責務とし、スキーマ・validator は展開しない |
| `memory[].entry` | string | 任意 | 入口ファイル。省略時の既定 `INDEX.md` は本契約（§3）が定める運用規約であり、スキーマ自体はキー省略を許すだけで既定値を強制しない |
| `memory[].include[]` | string[] | 任意 | 読む範囲を絞り込むパターン（重複なし。空文字不可） |
| `memory[].exclude[]` | string[] | 任意 | 読まない範囲を絞り込むパターン（重複なし。例: `10_accounting/**` — 「売上は読まなくていい」をここで表現する） |
| `memory[].read_policy` | string (const `"read-only"`) | 任意 | v0 は read-only 固定。省略時も read-only として扱う（§3） |

`providers[]` の $defs（`doctor` ブロック等）は `memory` には持ち込まない。`memory` は
資格情報も課金状態も持たない読み取り専用の宣言であり、doctor が書き戻す永続状態
（`doctor.status`/`last_checked`）を必要としない（§6 で詳述）。

## 2. 置き場所

プロジェクト内の **`.akari/connections.json`** の `memory` 配列としてのみ宣言する。

- プロジェクト外の新規置き場所は設けない。`root` は既存の外部パス（例: 事業 Wiki の
  リポジトリルート）を指すだけであり、本契約はどこにも新しいディレクトリを作らない
- プロジェクト外の永続置き場所の基底ディレクトリ裁定（`~/.akari-video/` か `~/.akari/` か）は
  `recipe.json` v0・スタイルプロファイル（系統 B）が新設する論点である。参照する場合は
  `docs/contract-2026-07-13-asset-library.md` 末尾「ディレクトリ名の裁定」を指すが、**本タスクの
  memory 接続はプロジェクト内 `.akari/connections.json` の宣言でありプロジェクト外置き場所は
  新設しないため、この裁定の適用対象外**であることを明記する
- 内部裁定の全文脈（系統 A / 系統 B の分離理由、4 層スコープとの整合）は
  内部リポ（akari-video-internal）の memory-and-style 契約 §0-§1 を正本とする

## 3. データ規律 — 全文投入の禁止と出所記録

1. **格納ではなく接続宣言**。`memory` は記憶ソースへのポインタであり、記憶ソースの中身を
   `.akari/` 配下へコピー・キャッシュしない
2. **読み取り専用**。v0 の `memory` 接続はサーバ・IPC を持たず、スキルがファイルシステムを
   直接読むだけ。`read_policy` は `"read-only"` 固定（書き戻しは§9）
3. **`entry` 起点**。記憶ソースの全文を読まない。`entry`（省略時 `INDEX.md`）から辿り、
   `include`/`exclude` で絞った範囲だけを読む（LLM Wiki の frontmatter・相互リンクに乗る）
4. **出所記録**。参照した記憶ファイルのパスは、読んだスキルの成果物（`research-plan.json`
   の `sources[]`、`decision-log.md`、`interpretation.json` の `inputs.context` 等、各スキルの
   既存語彙）に出所として記録する
5. **接続が無いのは正当な状態**。`memory` キー自体が無い、または空配列の connections.json
   は error にしない。読む記憶が無いだけとして通常フローを続行する（§5）

## 4. スキル配線 — 読む瞬間

`memory` を読んでよい瞬間は 3 箇所に固定する。それ以外の工程では読まない。

| 読む瞬間 | 対象スキル | 実装箇所 |
|---|---|---|
| ネタ出しの冒頭（方針立案前） | `skills/research-plan` | [SKILL.md](../skills/research-plan/SKILL.md) ハードルール（recipe recall の隣） |
| 方針提示の前段 | `skills/edit-plan` | [SKILL.md](../skills/edit-plan/SKILL.md) 実行順（recipe recall の隣） |
| 2 パス目の周辺プロジェクト文脈読み合わせ | `skills/analyze-project` | [SKILL.md](../skills/analyze-project/SKILL.md) ハードルール |

3 箇所とも同じ読み方をする: `.akari/connections.json` に `memory` 宣言があれば、`entry`
起点で `include`/`exclude` の範囲だけを読み、参照したファイルパスを成果物に出所として
記録する。全文投入は禁止。宣言が無ければ何もしない（error にしない）。

## 5. 劣化規約

`memory` はプロジェクトの参考情報であり、検証失敗や接続不備が編集・企画・分析工程を
巻き込んで失敗させない。

| 状況 | 挙動 |
|---|---|
| `memory` キーが無い、または空配列 | 正当な状態。読む記憶が無いだけで error にしない |
| `entry` を省略 | 既定 `INDEX.md` として扱う |
| `read_policy` を省略 | read-only として扱う |
| `root` が指すパスに実際にアクセスできない | [manage-connections](../skills/manage-connections/SKILL.md) の doctor が無償・読み取り専用で報告するのみ。読む瞬間（§4）のスキル実行そのものは止めない — 到達できない記憶は「今回は参照できなかった」として通常フローを続行する |
| `memory[].name` が配列内で重複 | スキーマ検証エラー（`validate-connections.mjs` が拒否する） |

## 6. データ設計意図

- **`name` が `providers[].id` と同じ pattern を使う理由**: `memory` は「プロジェクトが
  依存する外部」という点で generation provider・API キー参照と同格の接続であり、
  `connections.json` の中で呼び名の規約を統一する（`manage-connections` が両方を同じ
  レジストリとして管理するため。§0）
- **`root` がローカルパスのみである理由**: リモートソース（git URL・API 等）への対応は
  ネットワーク到達性・認証・キャッシュ戦略という別種の設計判断を要する。v0 は
  「プロジェクトが事業 Wiki を読む」という最小のユースケースに絞り、非スコープと明記する
  （§9）
- **`memory` が `doctor` ブロックを持たない理由**: `providers[].doctor` は資格情報の認証
  状態という永続すべき状態を持つ。`memory` は読み取り専用の存在チェックのみで、認証も
  課金も発生しないため、書き戻すべき永続状態が無い（memory の doctor 表示は都度の
  無償チェックに閉じる設計。§5・[manage-connections/SKILL.md](../skills/manage-connections/SKILL.md)）
- **`include`/`exclude` を持つ理由**: 事業 Wiki はプロジェクトより遥かに大きい（例:
  売上・経理データは動画プロジェクトに要らない）。`exclude` で `10_accounting/**` のような
  範囲を宣言的に除外できるようにし、「全文投入」を構造的に不可能にする
- **`entry` の既定を `INDEX.md` にする理由**: `_edit/CLAUDE.md` の LLM Wiki パターンにおいて
  `INDEX.md` が各階層の背骨（目次 + 該当リポへのリンク + 状態）として運用されている。
  記憶ソース側の既存の設計を前提にできるため、新しい入口の語彙を発明しない
  （内部 memory-and-style 契約 §1 準拠）
- **出所記録を義務化する理由**: Wiki 層の「主張は raw へリンクする」規律の鏡像。記憶を
  読んで得た結論も、どのファイルを踏まえたかを追跡できなければ、後から検証も反証も
  できない

## 7. よくある間違い

- **記憶ソースの全文を読み込む** — 誤り。§3 の 3。`entry` 起点で `include`/`exclude` の
  範囲だけを読む
- **`memory` 宣言が無いことを検証エラーにする** — 誤り。§3 の 5・§5。接続が無いのは
  正当な状態
- **参照した記憶ファイルのパスを成果物に記録しない** — 誤り。§3 の 4。出所を追跡できない
  参照は本契約の目的（読んで得をする代わりに検証可能性を落とさない）に反する
- **`root` が指すパスへ書き込む、または記憶ソースの中身を `.akari/` 配下へコピーする** —
  誤り。§0・§3 の 1-2。v0 は読み取り専用の接続宣言のみ
- **`memory` にリモート URL や API 参照を書く** — 誤り。§1・§6。v0 はローカルパスのみ
- **`providers[].doctor` のような永続状態を `memory` に持たせようとする** — 誤り。§1・§6。
  `memory` は doctor ブロックを持たない設計
- **`root` へのアクセス不可を理由に読む瞬間（研究計画・編集方針・分析）そのものを
  停止する** — 誤り。§5 の劣化規約。到達できない記憶は無視して通常フローを続行する

## 8. マイグレーション

（空欄 — `connections.schema.json` の破壊的変更は発生していない。`memory` の追加は
`$id` を変えない追加のみ進化。破壊的変更が必要になった場合はここに旧→新の機械実行可能な
変換手順を必ず併記する。`contract-2026-07-17` 原則 2）

## 9. 次段（本契約のスコープ外）

- 書き戻し（完了時に記憶ソースの Wiki 層へ要点サマリを書く動作。内部
  memory-and-style 契約 §1「書き戻し」節が構想を持つが、本契約は
  読み取りのみを扱う）
- リモートソース対応（git URL・API 経由の記憶接続。v0 はローカルパスのみ）
- インストール時デフォルト（setup-library first-run での既定記憶の質問）
- `intake.schema.json` への質問追加（プロジェクト作成時にどの記憶へ紐づくかの選択）
- スタイルプロファイル（系統 B。用語辞書・NG ワード・表記ルール・TTS 読み仮名等の
  ブランド規範。internal 契約 §2 に構想があるが、性質が異なる別契約として起草する）
- `connections.schema.json` 全体への `version` フィールド導入（§0 参照。`memory` の破壊的
  変更が実際に必要になった時点で検討する）
