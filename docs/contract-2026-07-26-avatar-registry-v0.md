---
lifecycle: draft
created: 2026-07-26
updated: 2026-07-26
---

# アバター・レジストリ契約 v0（avatar.json / rendition.json / 段階読み出し）

- 日付: 2026-07-26
- 状態: **ドラフト**（データ形・検証規律は確定して実装済み。ペルソナ核の文面は人間主導の層のため
  第 1 号アバターの記述内容自体は引き続きドラフト扱い）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（version 整数・追加のみ・寛容リーダーの
  三原則）、`contract-2026-07-13-asset-library.md`（4 層スコープ・カタログ構造の型）、
  `contract-2026-07-2X-edit-json-v1-narration.md`（narration 3 レーン。§10 で参照のみ）
- スコープ: アバター（性格・話し口調を持つ 1 人格）を登録するデータ契約 — ディレクトリ構造・
  段階読み出し・`avatar.json` / `rendition.json` / `relationships.json` のスキーマ・検証規律のみ。
  演出エンジンとの自動連携・登録ウィザード UI・VRM/Live2D/PSD インポートの実装は本契約のスコープ外
  （将来契約で扱う）

## 0. 位置づけ — アイデンティティが核、見た目と声は着せ替え

アバター = 「性格・話し口調を持つ 1 人格」であり、2D 立ち絵 / 3D モデル / 実写 / 音声プロファイルは
その人格の**表現形態（rendition）**として着脱可能に持つ。同一人格の複数バリアント（例
`ryoma-casual`）は別人格にせず、同一 `id` 配下の `variants` として持つ。

- **能力は宣言する**（素材ライブラリの `meta.json` のツマミ宣言と同型）。rendition ごとに
  「口パクできる・表情が何種類あるか・フレーミング（バストアップ/全身等）」を機械可読に宣言し、
  宣言のない能力は存在しないものとして扱う
- **読み出しは段階制**（§3）。1 行カード（L0）→ ダイジェスト（L1・AVATAR.md）→ 詳細ファイル
  （L2）の 3 段で、必要な深さだけ読む。日常の挿入判断・台本生成は L1 で完結する設計を前提とする
- **レジストリは器、資産は既存レーンで作る**。音声は narration-tts の 3 レーン、立ち絵は画像生成
  レーンの産物をここに登録するだけであり、本契約は生成手段を新設しない

## 1. 4 層スコープでの配置

素材ライブラリ契約（`contract-2026-07-13-asset-library.md` §「アセットのスコープ階層」）と同じ
4 層スコープをそのまま使う。

| 層 | 場所 | 備考 |
|---|---|---|
| `builtin` | 本リポの `assets/` 相当 | アバターは同梱しない（現時点で 0 体） |
| `catalog` | 本リポの `catalog/avatars/`（remote 相当の索引） | `rights.subject` が `original` / `third_party` のもののみ入庫可 |
| `user`（個人） | `~/.akari/avatars/` | 実在人物の顔・声を含むアバターはここが既定の置き場所 |
| `project` | プロジェクト内 `.akari/avatars/` | 案件専用キャラ |

- **実在人物の顔・声の実体ファイルは個人スコープに置く**ことを検証で強制する。`rights.subject`
  が `person` のアバターが公開 `catalog/avatars/` 配下パスにあることは検証エラーとする（§8・§11）
- 検索順序・shadowing の規則は素材ライブラリ契約の 4 層スコープに準じる

## 2. ディレクトリ構造 — 1 アバター = 1 ディレクトリ

```
avatars/
  INDEX.md                     ← L0: 全アバター 1 行カードの一覧（背骨）
  <id>/
    AVATAR.md                  ← L1: 段階読み出しの入口（SKILL.md 相当。§3）
    avatar.json                ← 機械可読正典（identity + 能力宣言 + 権利。§4）
    persona/
      persona.md                ← L2: ペルソナ全文（口調サンプル・語彙・NG 詳細）
      relationships.json        ← L2: 他アバターとの関係（§6）
    voice/
      voice.json                 ← L2: 音声プロファイル（レーン・speaker/profile 参照）
      samples/                   ← 収録サンプル（クローン元。個人スコープのみ）
    renditions/
      <rendition-id>/           ← rendition 1 つ = 1 ディレクトリ（例: 2d-bustup, 2d-fullbody, 3d, photo）
        rendition.json           ← 能力宣言 + アセット索引（§5）
        <アセットファイル群>       ← 表情差分・口パク差分・モデル等
    preview.png                 ← 一覧・decision card 用サムネ
```

- `persona/persona.md` と `persona/relationships.json` は L2 の任意ファイルであり、ペルソナ核の
  全文執筆が未着手の段階では省略してよい。省略時は `avatar.json` の `persona` オブジェクトが
  L1/L2 双方の唯一の出所になる（追って `persona.md` が用意され次第、そちらを正典に切り替える）

## 3. 段階読み出し契約

CLAUDE.md / SKILL.md の progressive disclosure をアバターに適用する。深読みの条件を明文化し、
それ以外は読まない。

| 段 | 実体 | 何が書いてあるか | いつ読むか |
|---|---|---|---|
| **L0** | `avatars/INDEX.md` の 1 行 | 例: `ryoma — 解説役。落ち着いた噛み砕きトーン。2D 全身/バストアップ(口パク可)・自声クローン` | アバター一覧・「誰かいる？」の解決 |
| **L1** | `AVATAR.md`（**135 行以内**） | frontmatter（`description` / `when_to_use`）+ ペルソナ要約（一人称・口調・NG 上位）+ 能力一覧表 + L2 への案内 | 挿入判断・台本生成・decision card 生成。日常工程はここで打ち止め |
| **L2** | `persona/` `voice/` `renditions/*/rendition.json` | 全文・全宣言 | 特定工程のみ: 口パク prerender → 該当 rendition のみ / 掛け合い台本 → `relationships.json` のみ / 音声生成 → `voice.json` のみ |

- AVATAR.md の frontmatter は素材 `meta.json` の `description` / `when_to_use` と同じ検索シグナル
  規約に従う（スキーマ横断で語彙を揃える）
- **AVATAR.md の行数上限は 135 行**。超過は `validate-avatar.mjs` の検証対象（欠落・逸脱は fail）
- AVATAR.md のペルソナ核は人間（オーナー/キャラ作者）が主導する。LLM は提案・整形にとどまる

## 4. `avatar.json` スキーマ v0

機械可読正典。フルスキーマは `packages/schemas/avatar.schema.json`（`$id:
urn:akari-video:schema:avatar:v0`）を参照。

```jsonc
{
  "version": 0,
  "id": "ryoma",
  "display_name": "Ryoma",
  "variants": [],                        // 例 ["ryoma-casual"]。別人格にしない
  "persona": {
    "first_person": "俺",
    "tone": "落ち着いた・親しみ",          // direction engine の tone 語彙を軸にした自由記述
    "speech_style": "噛み砕いて説明する。専門用語は一度ほどいてから使う",
    "verbal_tics": ["〜なんだよね"],
    "energy": 40,                        // 0-100。§9 参照
    "ng": ["断定的な投資助言"],
    "default_role": "explainer"          // §7 の配役語彙
  },
  "voice": {                             // 詳細は voice/voice.json。ここは解決に足る最小
    "lane": "fal-clone",                 // voicevox | fal-clone | recorded（narration-tts 準拠。§10）
    "ref": "profile:owner-ja",
    "credit": null
  },
  "renditions": [                        // 能力宣言の要約（詳細は各 rendition.json。§5）
    {
      "id": "2d-fullbody",
      "kind": "2d",                      // 2d | 3d | photo
      "capabilities": {
        "lipsync": true,
        "expressions": ["neutral", "happy", "..."],
        "framing": ["fullbody"]
      }
    }
  ],
  "default_rendition": null,             // null = 毎回 decision card で質問する（§7 相当の挿入フロー）
  "rights": {                            // §8。必須（省略不可）
    "subject": "person",                 // person | original | third_party
    "consent": "self",                   // self | signed:<path> | terms:<url>
    "credit_required": false,
    "distribution": "private"            // private | org | sellable
  }
}
```

## 5. `rendition.json` スキーマ v0

各 `renditions/<rendition-id>/rendition.json` の正典。フルスキーマは
`packages/schemas/avatar-rendition.schema.json`（`$id:
urn:akari-video:schema:avatar-rendition:v0`）を参照。

```jsonc
{
  "version": 0,
  "id": "2d-bustup",
  "kind": "2d",
  "capabilities": {
    "lipsync": true,
    "expressions": ["neutral", "happy", "sad", "angry", "surprised", "laugh"],
    "framing": ["bustup"]
  },
  "assets": {                            // rendition ディレクトリ相対のファイル名索引
    "expressions": {
      "neutral": "master-neutral-closed.png",
      "happy": "happy.png"
      // ... capabilities.expressions の各要素に対応
    },
    "lipsync": {                          // 口パク状態（例: neutral-closed / neutral-half / neutral-open）
      "neutral-closed": "master-neutral-closed.png",
      "neutral-half": "neutral-half.png",
      "neutral-open": "neutral-open.png"
    }
  }
}
```

- `assets` に列挙された全ファイル名は、検証時に rendition ディレクトリ配下の実ファイルへ解決
  できる必要がある（欠落は fail・全数列挙。§11）
- `capabilities` は `avatar.json` 側の `renditions[].capabilities`（要約）と同じ形を持つ。詳細な
  アセット索引を持つのはこの `rendition.json` 側

## 6. `relationships.json` スキーマ v0（複数アバターの関係性）

複数アバターの掛け合いは個体ペルソナだけでは書けない。呼称と距離感はペアの属性として
`persona/relationships.json` に持つ（L2・掛け合い台本生成のときのみ読む）。

```jsonc
{
  "version": 0,
  "relations": [
    {
      "to": "zundamon",                  // 相手アバターの id
      "calls_them": "ずんだもん",         // 呼称
      "register": "casual",               // casual | polite
      "dynamic": "先生と生徒（教わる側に回ると面白い）"  // 関係性の一言説明
    }
  ]
}
```

- 片方向宣言（A→B と B→A は別行）。アバターが 1 体のみの登録では空 `relations: []` でよい
- 本ファイルの**消費**（関係性を踏まえた掛け合い台本生成）は将来段階のスコープであり、本契約は
  データ形のみを定める

## 7. 配役語彙（5 種）

`explainer`（解説役） / `listener`（聞き役） / `tsukkomi`（ツッコミ役） / `narrator`（ナレーター）
/ `guest`（ゲスト）の 5 語で開始する（追加のみ進化）。`persona.default_role` が既定値であり、
シーン単位で上書きしてよい。

## 8. 権利・ライセンス欄（`rights`・必須）

`rights` は avatar.json の必須フィールドであり、省略は検証エラーとする。

| フィールド | 値 | 意味 |
|---|---|---|
| `subject` | `person` / `original` / `third_party` | `person`=実在人物、`original`=自作キャラ、`third_party`=VOICEVOX キャラ等 |
| `consent` | `self` / `signed:<path>` / `terms:<url>` | 本人同意の記録（`person`）・署名済み同意書パス・第三者規約 URL |
| `credit_required` | boolean | クレジット表記義務の有無 |
| `distribution` | `private` / `org` / `sellable` | 配布範囲 |

- `subject: "person"` のアバターは `distribution: "sellable"` にできない（検証エラー）
- `subject: "person"` のアバターは公開 `catalog/avatars/` 配下に置けない（§1・検証エラー）
- `subject: "third_party"` は規約 URL とクレジット義務を `consent` / `credit_required` に記録する

## 9. `energy` とドパ度の別軸定義

`persona.energy`（0-100 の整数）は、演出エンジン契約の「ドパ度」（演出の派手さ）とは**別軸**の
値である。

- **ドパ度** = 演出の派手さ（フック等の編集強度。演出エンジン / intake wizard の語彙）
- **`energy`** = キャラ自身のテンション・熱量（0 = 落ち着き・クール、100 = ハイテンション）

両者は**尺度（0-100 のレンジ）だけを共用**し、意味論は混同しない。例えば `energy` が高い
（熱いキャラ）を低いドパ度（落ち着いた演出）の動画で使う組み合わせは正当である。

## 10. 音声の扱い（新設なし・参照のみ）

アバターの声は narration-tts 契約の 3 レーン（`voicevox` / `fal-clone` / `recorded`）をそのまま
消費する。本契約が足すのは「台本の話者 = アバター → voice 解決が自動になる」という参照関係のみで
あり、レーン・エンジンアダプタ・provenance 規約は narration-tts 契約側が正本のまま変わらない。

## 11. 検証

`packages/schemas/bin/validate-avatar.mjs <avatar-dir>` が以下を検証する:

1. `avatar.schema.json` / `avatar-rendition.schema.json` に対する構造検証
2. `rights` 欄の必須化（欠落は fail）
3. `rights.subject: "person"` × `rights.distribution: "sellable"` の禁止
4. `rights.subject: "person"` のアバターが公開 `catalog/avatars/` 配下にあることの禁止
5. `AVATAR.md` の 135 行上限
6. 各 `rendition.json` の `assets` に列挙された全ファイル名が実ファイルへ解決できること（欠落は
   全数列挙）

## 12. 版管理

`version`（整数・0 起算）・追加のみ進化・寛容リーダー・snake_case の三原則
（`contract-2026-07-17-data-contract-versioning.md`）を `avatar.json` / `rendition.json` /
`relationships.json` の全てに適用する。破壊的変更は明示マイグレーションを伴う `version` bump
としてのみ行う。

## 13. 改訂注記（S2・2026-07-26）

- **`renditions` の `minItems` を `1` から `0` へ緩和した**（`packages/schemas/avatar.schema.json`
  / `validate-avatar.mjs`）。voice-only アバター（rendition を持たず声のみを登録するケース。
  例: §1 の VOICEVOX プリセット提案を個人スコープへ登録するとき）を表現するため。既存の
  `avatar.json`（`renditions` 1 件以上）は全て valid のまま（三原則「追加のみ進化」に適合。
  破壊的変更ではない）
- `renditions: []` のとき `default_rendition` は必ず `null` のままとする（選べる rendition が
  無いため。非 `null` を指定すると `renditions[]` に存在しないとして検証エラーになる）
- §4 の `avatar.json` サンプルは `renditions` 1 件以上のケースのまま変更していない
  （voice-only は本節の追記のみで表現し、既存サンプルを voice-only に書き換えない）
