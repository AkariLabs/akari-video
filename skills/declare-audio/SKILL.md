---
name: declare-audio
description: 手元の音源に「サビはどこか・キメはどこか・拍はどこか」を自分の耳で付ける（宣言づけ）。ブラウザで開くタイムライン画面を起動し、人が波形にサビ区間とキメのピンを打ち、BPM・頭拍を確定して declarations.json へ保存する。付けた宣言は BGM 自動提案（suggest-bgm）がそのまま読み、実測 BPM とサビ頭出し（audio.bgm.in）付きの提案になる。「この曲のサビを教えたい」「BGM の提案が雑」「拍に合わせて切りたい」「宣言を自分で作りたい」で発動。音源を増やすのは setup-audio-library（別物）。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる。

次のいずれかに違反する形で宣言づけを進めない。詳細リーフより常に優先する。

1. **宣言はエージェントが打たない。人が耳で決める。** このスキルの仕事は「画面を起動して、
   何を打つべきかを案内し、保存されたものを検証する」ところまでである。BPM の自動推定値を
   そのまま「確定した宣言」として保存させない（推定は出発点であり、**クリック音での耳の
   答え合わせを必ず案内する**）。
2. **推定値を実測と偽らない。** 自動推定は ±1〜2 BPM ずれる（打点の弱い曲・AI 生成曲の
   テンポ揺れでは特に）。レポートに書くときは「推定」「本人が耳で確認済み」を区別して書く。
3. **音声実体を本リポにコミットしない。** 対象はユーザーのライブラリ（既定
   `~/.akari/assets/audio/`）であり、リポジトリには宣言も音声も置かない。
4. **他所由来の宣言を黙って上書きしない。** 購入した宣言パック等（`source` が
   `declare-audio` 以外）を上書きするときは、画面の「パック由来」バッジをユーザーに
   知らせてから進める（保存時は `replaced_source` に記録が残る）。
5. **`declarations.json` を手で書かない。** 保存はサーバ経由（妥当性検査つき）に一本化する。
   壊れた区間・語彙外ラベルが入ると編集側の自動提案が壊れる。
6. **サーバは `127.0.0.1` のみにバインドする。** 外部公開しない。
7. **「宣言済み」と報告する前に、保存された内容を読み返して件数を確認する。**
   （`declarations.json` を読む。画面のメッセージだけで完了を報告しない）

# 実行順リーフ

1. [launch.md](launch.md) — 画面の起動とユーザーへの案内（起動 → URL 提示 → 操作の要点）
2. [what-to-declare.md](what-to-declare.md) — 何を打つべきか（サビ最優先・ピンは疎で足りる・
   品質の目安）。ユーザーが「何を打てばいいの？」と聞いたときはここを案内する
3. [after-save.md](after-save.md) — 保存後の検証と、宣言が効いていることの確かめ方
   （suggest-bgm で実測 BPM・サビ頭出しが出るか）

詳細を先読みせず、現在の工程に対応するファイルだけを読む。

## このスキルが要るとき / 要らないとき

| 状況 | 使うもの |
|---|---|
| 手元の曲に「サビはここ」を教えて、BGM 提案とサビ頭出しを賢くしたい | **本スキル** |
| 音源そのものを増やしたい（公式ライブラリの一括取得・外部の補完） | [setup-audio-library](../setup-audio-library/SKILL.md) |
| AKARI Sounds の曲に、自分で打たずに検証済みの宣言が欲しい | AKARI Store の宣言パック（耳検証済みデータの版ごと買い切り。導入は zip 内の `declarations.json` を `~/.akari/assets/audio/` に置くだけ） |
| 宣言を使って BGM を選びたい（宣言づけではなく利用側） | `packages/audio-library-setup/bin/suggest-bgm.mjs` / [edit-plan](../edit-plan/SKILL.md) の素材計画 |

## 宣言の形（保存先と契約）

保存先は **`<ライブラリ>/declarations.json`**（既定 `~/.akari/assets/audio/declarations.json`）。
`suggest-bgm` が既定パスとして自動検出する場所であり、キーはトラック id。

```json
{
  "bgm-lofi-085-001": {
    "bpm": 86.1,
    "beat_offset_s": 0.743,
    "time_signature": "4/4",
    "sections": [
      { "label": "intro", "start_sec": 0, "end_sec": 11.2 },
      { "label": "drop", "start_sec": 11.2, "end_sec": 44.8 }
    ],
    "hit_points": [11.2, 33.6],
    "note": "",
    "verified_at": "2026-08-04T01:23:45.000Z",
    "source": "declare-audio"
  }
}
```

- `label` の語彙は 6 値固定: `intro` / `build` / `drop` / `outro` / `bridge` / `break`
  （画面では 前奏・導入 / 盛り上げ / サビ・見せ場 / 後奏・締め / 間奏 / 静寂）。**発明しない**
- **最初の `drop` の `start_sec` が「サビ頭出し」**になり、`edit.json` の `audio.bgm.in` に
  そのまま書ける値として提案に出る
- `hit_points` は「写真・カットの入れ替えを決めたい拍」の秒。多く打つ必要はない

## 根拠

- 契約: [`docs/contract-2026-07-14-edit-json-v1-audio.md`](../../docs/contract-2026-07-14-edit-json-v1-audio.md)
  （`audio.bgm.in` = BGM ファイル内の開始オフセット）
- 実装: `packages/audio-library-setup/declare-server.mjs` / `declare-template.html` /
  `bin/declare-helper.mjs`（127.0.0.1 のみ・外部 npm 依存ゼロ・状態は atomic 書き込み。
  試聴ギャラリー `gallery-server.mjs` と同じ流儀）
- 利用側: `bin/suggest-bgm.mjs`（宣言があるトラックは実測 BPM 置換・優先表示・サビ頭出し付き）
