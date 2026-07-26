# 人・キャラクター（アバター）を挿入する

## 原則

アバターの読み出しも CLAUDE.md / SKILL.md と同じ段階制に従う。**「Ryoma 入れて」のような挿入
要求に対して全アバターの全データを読まない**。L0（一覧）→ L1（AVATAR.md）の 2 段で日常の挿入判断
は完結させ、L2（`persona/` `voice/` `renditions/*/rendition.json`）は下記「L2 深読みの条件」に
明記した特定工程でしか読まない。データ形の正本は
[アバター・レジストリ契約](../../docs/contract-2026-07-26-avatar-registry-v0.md) にある。本リーフは
その器を挿入フローの中で**どう読み・どう質問するか**を定める。

## 発動条件

チャットで人物・キャラクター・アバターの挿入を求められたとき（例:「Ryoma のやつ入れて」
「ずんだもんに解説させて」）。生成対象がゼロから作るキャラクターではなく、既存の登録済み
アバターを指している場合が本リーフの対象。新規登録（音声サンプル → クローン、立ち絵取り込み等）
は本リーフのスコープ外（登録ウィザードは将来段階）。

## 手順

### 1. L0 — INDEX で ID を解決する

以下の順で `avatars/INDEX.md` を読み、要求と一致する 1 行カードを探す（4 層スコープの近い順。
[契約](../../docs/contract-2026-07-26-avatar-registry-v0.md) §1）:

1. プロジェクト内 `.akari/avatars/INDEX.md`
2. `~/.akari/avatars/INDEX.md`（個人スコープ。実在人物のアバターは通常ここにある）
3. 公開 `catalog/avatars/INDEX.md`（`original` / `third_party` のみ）

同一 ID が複数層にあれば近い層が勝つ（shadowing）。一致する ID が無ければ「該当アバターが
見つからない」と人間に報告し、後段の登録は別スキル（将来段階）に委ねる。

### 2. L1 — 該当 AVATAR.md のみ読む

解決した ID の `AVATAR.md` **だけ**を読む。他アバターの AVATAR.md、`persona/`、`voice/`、
`renditions/*/rendition.json` は読まない。ここで得られる情報だけで以下を判断する:

- ペルソナ要約（一人称・トーン・口調・NG 上位）— 台本生成のプロンプト文脈に注入する
- 能力一覧表 — rendition ごとの `lipsync` / `expressions` / `framing`
- `avatar.json` の `default_rendition`

### 3. rendition 解決

`avatar.json`（L1 から参照される機械可読値）の `default_rendition` を見る:

| 状態 | 動作 |
|---|---|
| `default_rendition` が非 null | それを採用し、選択したことのみ人間に報告する（質問しない） |
| `default_rendition` が null かつ rendition 候補が複数 | **decision card**（§4）で「どれで入れますか？」と質問する |
| `default_rendition` が null だが文脈で候補が一意に絞れる（例: 口パク必須の解説シーンで `lipsync: true` が 1 つだけ） | 自動選択し、選択根拠を `decision-log.md`（§6）に記録する（質問しない） |

### 4. decision card（候補が複数 & 既定なしのとき）

edit-plan は自身の方針決定に汎用カード機構（HTML の `data-card`。
[report-guide.md](report-guide.md#汎用カード機構他スキルが参照する仕様) 参照。research-plan 等
他スキル向けの仕様であり edit-plan 自身は使わない）を使わない。アバター挿入も edit-plan の実行
フロー内で起きる判断のため、同じ規律に従い**チャットで質問する**（[report-guide.md](report-guide.md#方針をチャットで決める)
の「推奨案 + 代替案 + 利点/欠点/理由を示し、明示回答を得る」形式を rendition 選択に適用する）。
「どうしますか」と丸投げしない。1 選択肢につき「rendition id + プレビュー（`preview.png` または
rendition ディレクトリ内画像）+ 能力 1 行」を示す。

worked example（`ryoma` を想定。`default_rendition: null`・候補 2 件）:

```
質問: Ryoma をどれで入れますか？
- [2d-bustup]   バストアップ・口パク可（neutral/happy/sad/angry/surprised/laugh）
- [2d-fullbody] 全身・口パク可（neutral/happy/sad/angry/surprised/laugh）
推奨: 2d-bustup（ワイプ挿入で画面占有率が低いシーンのため。フルショットなら 2d-fullbody を推奨）
```

推奨（AI 既定案）はシーンの文脈（例: 画面占有率の低いワイプ挿入ならバストアップ、フルショット
なら全身）から選ぶが、確定は人間の明示回答を経る。

### 5. L2 深読みの条件（このときだけ読む)

内部契約 §3 の条件をそのまま踏襲する。日常工程では読まない:

| 工程 | 読むファイル |
|---|---|
| 口パク prerender | 選択済み rendition の `renditions/<id>/rendition.json` のみ |
| 掛け合い台本（複数アバター） | `persona/relationships.json`（存在する場合のみ） |
| 音声生成 | `voice/voice.json` |

`persona/persona.md`（ペルソナ全文）は存在すれば同様に L2 として扱う。存在しない場合は
`avatar.json` の `persona` オブジェクト（L1 と同じ内容）が唯一の出所であり、それ以上深く読む
ファイルは無い。

### 6. `decision-log.md` への記録

rendition 選択（チャットでの質問経由・自動選択いずれも）は根拠つきで `decision-log.md`
（[report-guide.md#decision_log](report-guide.md#decision_log)）へ追記する。[expression-selection.md](expression-selection.md#根拠の記録)
の素材選択記録と同じ粒度・同じファイルへ、`rendition` category で 1 行積む:

```text
<avatar id> @ <timeline 秒> | category: rendition | subject: <avatar id>/<選んだ rendition id> |
決定: <採用した rendition id> | 理由: <1 文> | 決定者: human|ai-auto | checkpoint: <関連チェックポイント>
```

- **自動選択も却下も 1 行を書く**（黙って決めない・黙って落とさない。expression-selection.md
  §根拠の記録と同じ規律）
- 自動選択の根拠が繰り返されたら、スタイル記憶（系統 B）が `default_rendition` への昇格を人間に
  提案してよい（勝手に書き込まない）
- 本節の記録運用自体（実装・自動化）は S2 のスコープ。本リーフは記録すべき内容の規約のみを定める

## 台本生成への接続

台本がある場合、L1 のペルソナ要約を台本生成のプロンプト文脈に注入し、`voice` 解決を
narration-tts レーンへ渡す。`edit.json` 側は既存契約のまま変更しない — narration provenance の
`voice` にアバター参照が入るだけであり、新しいフィールドは発明しない。
