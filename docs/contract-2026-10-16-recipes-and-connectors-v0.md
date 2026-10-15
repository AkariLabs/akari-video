---
lifecycle: draft
created: 2026-10-16
updated: 2026-10-16
---

# recipes-and-connectors-v0（レシピと接続の 2 層）契約

- 日付: 2026-10-16
- 状態: **ドラフト・語の裁定待ち**（§6。形と層の分け方は確定方向、「レシピ」の語の割り当てが未裁定）
- 前提: `contract-2026-07-14-3d-bake-recipe.md`（道具のレシピ = 正本、焼いた出力 = 再生成できるキャッシュ）/
  `contract-2026-09-13-extension-kit-v0.md`（キットの manifest。v0 の `kind` は `kit` のみ）/
  `packages/schemas/connections.schema.json`（接続の台帳。`kind`: genai / image / video / tts / music / sns / analytics / notify）/
  `packages/schemas/gen-models.json`（生成モデルの台帳）/ `contract-2026-10-15-playbook-v0.md`（作り方）/
  `contract-2026-10-15-project-manifest-v0.md`（tool-output の `recipe` / `connector`）/
  `contract-2026-10-16-automation-gates-v0.md`（`paid` / `external-send` / `license` の門）
- 発端: 外の道具・サービス（生成 AI・音楽生成・3D・TTS）が増えると、「何をしたいか」と「どのサービスで叩くか」が
  1 つの手順に混ざり、サービスを差し替えるたびに手順が壊れる。公式の API が無いサービスは自前のアダプタが要り、
  それはプラグイン的な部品になる
- スコープ: 層の分け方・能力（capability）の語彙・接続の宣言・アダプタの配り方・manifest への記録。
  **個々のアダプタの実装・非公式な叩き方の同梱・MCP サーバーは扱わない**（§5）

## 1. 3 つの層

| 層 | 単位 | 例 | 持つもの | 正本 |
|---|---|---|---|---|
| 作り方（Playbook） | 動画 1 本の流れ | 15 秒 CM | 工程と確認点。工程からレシピを呼ぶ | `playbook.json` |
| **レシピ** | **シチュエーション（やりたいこと）** | BGM を 30 秒作る・商品を 3D で回す・口パクを付ける | 入力・ツマミ・出力の形・確認点・**要る能力** | `recipe` の宣言（§3） |
| **接続** | **サービス・ソフトウェア** | fal・ElevenLabs・Blender・（音楽生成のサービス） | 認証・叩き方（公式 API / 自前アダプタ / ローカル実行）・料金・規約・**持つ能力** | `connections.json` の 1 件 + アダプタ |

- レシピはサービスの名前を書かない。**能力**だけを書く（`needs: ["music-generation"]`）。どの接続で叩くかは、
  その時に使える接続（認証済み・規約の確認済み）から選ぶ。差し替えてもレシピと作り方は変わらない
- 3D ベイクのレシピ（`assets/scene3d/<id>/scene.py`）は「レシピ = 3D で回す」と「接続 = Blender（ローカル実行）」が
  一体になった形として読む。分けるのは 2 つ目の 3D の道具が要ったとき

## 2. 能力の語彙（閉じた表・追記して増やす）

| capability | 中身 | 既存の対応 |
|---|---|---|
| `image-generation` | 画像を作る | connections `image` / gen-models `kind: image` |
| `video-generation` | 動画を作る（i2v・t2v） | connections `video` / gen-models `kind: video` |
| `music-generation` | 曲を作る | connections `music` |
| `speech-synthesis` | 読み上げ | connections `tts` |
| `3d-render` | 3D を焼く | 3D ベイクレシピ（Blender headless） |
| `transcription` | 文字起こし | 既存の transcribe 系 |
| `publish` | 投稿する | connections `sns`（門 `publish`） |

## 3. 宣言の形（最小）

レシピ:
```json
{ "version": 0, "kind": "akari-recipe", "id": "bgm-30s", "name": "BGM を 30 秒作る",
  "needs": ["music-generation"], "inputs": { "mood": "string", "durationSec": 30 },
  "outputs": [{ "kind": "audio", "role": "bgm" }], "checkpoint": "聞いて選ぶ", "gates": ["paid", "external-send"] }
```
接続（`connections.json` の既存の 1 件に足す項目）:
```json
{ "id": "example-music", "kind": "music", "provides": ["music-generation"],
  "adapter": { "type": "official-api" }, "terms": { "checked": "2026-10-16", "commercialUse": "allowed" } }
```
- `adapter.type`: `official-api`（公式 API）/ `local`（手元で実行する道具）/ `custom`（自前のアダプタ）
- `custom` のアダプタは拡張キットで配る（キットの `kind` に `tool` を足す。キット契約の改訂が要る）
- `terms.checked` が無い接続は `license` の門で止まる

## 4. 記録

レシピを回して出たファイルは、プロジェクトの manifest に `tool-output` として載せる:
`recipe: "<id>@<version>"`・`connector: "<接続の id>"`・`inputs_sha256`。同じレシピと入力で作り直せること、
接続を差し替えたら何が変わったかが追えること。

## 5. 非スコープと規律

- 公式の API が無いサービスを非公式に叩くアダプタは**同梱しない**。配る場合は個別に審査する（相手の規約に触れうる）
- 有償・外部送信は門（`paid` / `external-send`）。どのおまかせ度でも止まる
- MCP サーバーは作らない（2 種類目のエージェントか外部アプリが要ったとき）。外から叩く口はファイル契約と `akari` の副コマンド
- 個々のアダプタの実装・レシピの GUI

## 6. 開けた問い（オーナー裁定待ち）

1. **語**: 「レシピ」は既に `contract-2026-07-25-recipe-v0.md`（好みの凍結 `recipe.json`。ドラフト・スキル 2 本が参照）と
   3D ベイクのレシピで使われている。シチュエーションの層を「レシピ」と呼ぶなら、好みの凍結の側を「好み」などへ改名するか
2. 置き場: レシピの宣言を キット（`recipes/<id>/recipe.json`）と手元（`~/.akari/…`）のどこに置くか（1 の語が決まってから）
