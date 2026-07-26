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
| `default_rendition` が null だが文脈で候補が一意に絞れる（§3a の判定規則を適用して残る候補が 1 件になる） | 自動選択し、選択根拠を `decision-log.md`（§6）に記録する（質問しない） |

### 3a. 自動選択の判定規則（能力宣言ベース、S2 具体化）

「文脈で一意」を当てずっぽうにしない。以下の判定規則を**候補を絞るフィルタ**として順に適用し、
適用後に残った候補が 1 件になった時点で自動選択する。複数のシグナルが同時に文脈にあれば、
該当するフィルタを**すべて**適用してから残数を数える（例: 「口パク必須のワイプ解説」は
lipsync フィルタ + framing フィルタの両方を適用する）。

| 文脈シグナル | フィルタ規則 | 参照する宣言 |
|---|---|---|
| 口パク必須（有声の台詞・ナレーションをそのアバターに喋らせるシーン） | `capabilities.lipsync !== true` の rendition を候補から除外する | `avatar.json` の `renditions[].capabilities.lipsync` |
| ワイプ挿入（画面占有率が低い・隅に小さく挿入する構図） | `capabilities.framing` に `"bustup"` を含む rendition を優先する（他の framing のみの候補は除外） | `renditions[].capabilities.framing` |
| フルショット（画面占有率が高い・画面の主役として映す構図） | `capabilities.framing` に `"fullbody"` を含む rendition を優先する（他の framing のみの候補は除外） | `renditions[].capabilities.framing` |

- フィルタを全て適用しても候補が**複数残る**、または**文脈シグナルが読み取れない**場合は、
  従来どおり §4 の decision card で質問する（後退させない — 自動選択は「わかるときだけ」）
- フィルタの結果候補が **0 件**になった場合（例: 口パク必須なのに lipsync 可な rendition が
  1 つも無い）も自動選択はせず、decision card で状況を明示して質問する
- 自動選択したときも、質問して決めたときも、**必ず** `decision-log.md`（§6）へ根拠 1 行を記録する

worked example（`ryoma` を想定。`2d-bustup` / `2d-fullbody` はいずれも `lipsync: true`）:

```
文脈: 「口パク必須の解説シーンをワイプ挿入で使う」
1. lipsync フィルタ: 2d-bustup（lipsync: true）/ 2d-fullbody（lipsync: true）→ 両方残る
2. framing フィルタ（ワイプ→ bustup 優先）: 2d-bustup（framing: [bustup]）のみが該当 →
   2d-fullbody（framing: [fullbody]）を除外
3. 残り candidate = 1 件（2d-bustup）→ 自動選択
```

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
- **自動選択（決定者: ai-auto）の理由欄は §3a のどのフィルタが効いたかを 1 文で書く**（例:
  「口パク必須 + ワイプ挿入 → framing=bustup かつ lipsync:true が 1 件のみ」）。フィルタ名を
  省略した曖昧な理由（「文脈から判断」等）は書かない — 後から根拠を検証できることが目的
- decision card 経由（決定者: human）の理由欄は人間の回答・確定内容をそのまま要約する
- 本節の記録運用自体（実装・自動化）は S2 のスコープ。本リーフは記録すべき内容の規約のみを定める

### 6a. 既定化提案（`default_rendition` への昇格、S2 新設）

同一アバター・同一 rendition の選択（決定者が human/ai-auto いずれでも可）が、`decision-log.md`
の `rendition` category かつ `subject: <avatar id>/*` で**直近 3 回連続**で並んだら（間に別の
rendition を選んだ行が挟まっていない）、`default_rendition` への昇格をチャットで**提案**する。
勝手に書き込まない — 承認を得たときのみ書き込む（内部契約 §7-3）。

1. **検知**: `decision-log.md` を `subject` が `<avatar id>/` で始まる `rendition` category の行
   だけ時系列に抽出し、末尾から連続する行の「決定」列が同一 rendition id かどうかを見る。3 行
   連続で同一なら昇格提案の対象
2. **提案文の生成**（チャットで提示。report-guide.md の「推奨案 + 理由を示し、明示回答を得る」
   形式を踏襲）:

   ```
   提案: <avatar id> の rendition は直近 3 回連続で `<rendition id>` が選ばれています。
   以後は質問せずこれを既定にしますか？（`avatar.json` の default_rendition へ書き込みます）
   ```

3. **承認を得たときのみ** `avatar.json` の `default_rendition` を該当 rendition id で書き込む。
   却下された場合は書き込まず、`decision-log.md` に却下決定を 1 行記録する（§6 の規律どおり）
4. **書き込み後は必ず `validate-avatar.mjs` を実行**し、PASS を確認する（`default_rendition` が
   `renditions[]` に存在しない typo 等を検出できる）
5. 昇格後の挿入は §3 の表の 1 行目（`default_rendition` 非 null）に従い、以後は質問せず採用する

## 台本生成への接続（persona 注入、S2 具体化）

台本・ナレーション原稿をアバターに喋らせる工程（plan.json の対話で構成を決めた後、または
既存台本にアバターの発話を割り当てる工程）では、原稿を生成する前に **L1（AVATAR.md /
`avatar.json` の `persona`）のペルソナ要約を原稿生成のプロンプト文脈へ注入する**。

### 注入する項目

`persona` オブジェクトの以下 6 項目をそのまま原稿生成の指示文脈に含める（要約や意訳をせず、
登録されている値をそのまま使う — 別の口調に脚色しない）:

| 項目 | 使い方 |
|---|---|
| `first_person` | 台詞中の一人称をこれに統一する |
| `tone` | 全体のトーン（語り口の温度感）をこれに合わせる |
| `speech_style` | 説明の噛み砕き方・専門用語の扱いをこれに従う |
| `verbal_tics` | 語尾・口癖として台詞に自然に混ぜる（多用しすぎない） |
| `energy` | 文の長さ・テンポ・感嘆符の使用頻度をこの値の高低に合わせる（0=落ち着き、100=ハイテンション） |
| `default_role` | シーンで別の役割が明示指定されていない限り、この配役として原稿を書く |

### NG の遵守（生成前チェック）

`persona.ng` に列挙された話題・言い回しに触れる原稿は**生成しない**。これは lint（生成後の
機械検査）ではなく、**生成前の手順の規律**として扱う — 原稿を書く前に `ng` リストを読み、
該当しそうな切り口を避けて構成する。生成後に気づいた場合は、その場で書き直す（`ng` 抵触のまま
一度チャットに出してから修正、はしない）。

### voice 解決への接続

原稿が確定したら、話者 = アバターの `voice` 解決を行う。手順は
[skills/generate-narration/avatar-voice.md](../generate-narration/avatar-voice.md) に従う。
`edit.json` 側は既存契約のまま変更しない — narration provenance の `voice` にアバターの
`voice.ref`（`speaker:3(...)` / `profile:owner-ja` 等、narration-tts 契約と同型の参照文字列）が
そのまま入るだけであり、新しいフィールドは発明しない。

## VOICEVOX プリセット提案 + 登録（S2 新設）

アバター挿入を求められた工程で、L0 走査（§1）の結果**登録済みアバターが 0 体**（または
`voice` を持つアバターが 0 体）だったとき、決め打ちのプリセット 2 体を「こういうのもあるよ」と
提案する（内部契約 §1・オーナー裁定「同梱はしない。あるよっていうだけ」）。

### 前提条件

提案するのは **VOICEVOX doctor が `ok` のときだけ**（`skills/manage-connections/bin/doctor.mjs`
の `voicevox` チェック。narration-tts 契約・[engines.md](../generate-narration/engines.md) の
規律と同じ — 動かせないレーンを選択肢として見せない）。doctor が `ok` でなければ、この提案自体を
省略する（他の挿入判断は通常どおり進める）。

### 提案カード（2 体固定）

| id | display_name | 性別 | speaker（VOICEVOX ノーマル） | 出典・クレジット条件 |
|---|---|---|---|---|
| `zundamon` | ずんだもん | 男の子 | id 3 | [zunko.jp 音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)。クレジット「VOICEVOX:ずんだもん」表記が必要（無表記商用は 1 キャラ 40 万円+税） |
| `shikoku-metan` | 四国めたん | 女性 | id 2 | 同上規約（同一プロジェクト配下・同一条件）。クレジット「VOICEVOX:四国めたん」表記が必要 |

提示文の型（チャットで示す。「こういうのもあるよ」の温度感を保ち、選択を強制しない）:

```
こういうのもあるよ: VOICEVOX の既製声プリセットが 2 体あります（ゼロ円・ローカル・数秒）。
- ずんだもん（男の子・id 3） — 出典/規約: zunko.jp（クレジット「VOICEVOX:ずんだもん」表記必須）
- 四国めたん（女性・id 2） — 出典/規約: zunko.jp（クレジット「VOICEVOX:四国めたん」表記必須）
選びますか？（選ばなくても続行できます）
```

### 登録（選ばれたときのみ）

1. `~/.akari/avatars/<id>/` を新規作成する（個人スコープ。公開 `catalog/avatars/` には置かない
   — third_party でも本タスクでは個人スコープ登録のみを扱う）
2. `avatar.json` を作る:
   - `rights`: `{"subject": "third_party", "consent": "terms:https://zunko.jp/con_ongen_kiyaku.html", "credit_required": true, "distribution": "private"}`
   - `voice`: `{"lane": "voicevox", "ref": "speaker:<id>(<名前>/ノーマル)", "credit": "VOICEVOX:<名前>"}`
   - `renditions`: `[]`（voice-only。S2 の schema 緩和 §該当 — 契約
     [docs/contract-2026-07-26-avatar-registry-v0.md](../../docs/contract-2026-07-26-avatar-registry-v0.md) §13）
   - `default_rendition`: `null`
3. `AVATAR.md` を作る: 公式キャラ設定を出典 URL つきで引用し、**創作で盛らない**（性格・特徴は
   引用のまま。口調の細部など出典で確認できない項目は「一次情報未確認・オーナー確認事項」と
   明記する）。加えて、**人選そのものが「オーナー追認待ちの仮採用」であることを明記する
   1 行注記**を入れる
4. `voice/voice.json` を作る: `lane: "voicevox"`, `speaker id`, `credit` を記録する（`avatar.json`
   の `voice` と同内容。L2 の詳細版）
5. 登録後、`validate-avatar.mjs ~/.akari/avatars/<id>` を実行し **PASS** を確認する
6. `~/.akari/avatars/INDEX.md`（L0）に 1 行カードを追記する
