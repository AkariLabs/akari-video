# アバターの声を narration-tts レーンへ自動解決する（S2 新設）

台本の話者がアバター（[edit-plan/avatar-resolution.md](../edit-plan/avatar-resolution.md) で
解決済み）のとき、そのアバターの `voice/voice.json`（L2。このときだけ読む — 他のアバターの
`voice/` は読まない）を読み、`lane` / `ref` / `credit` を [engines.md](engines.md) の 3 レーンへ
そのまま渡す。**アバター専用の新しいエンジン・新しいフィールドは発明しない** — voice-tts
契約の既存 3 レーンをアバターの登録値で呼び出すだけの薄い解決層である。

## 解決手順

1. `voice/voice.json`（無ければ `avatar.json` の `voice` オブジェクト。同内容）から
   `lane` / `ref` / `credit` を読む
2. `lane` に応じて engines.md のコマンドへ引数を組み立てる（下表）
3. 生成後、`credit` が非 null なら [credit の転写](#credit-の転写) の手順で `provenance.credit`
   に反映されていることを確認する
4. `edit.json` のスキーマは変更しない — `audio.narration[].provenance.voice` にはアバターの
   `voice.ref`（`speaker:3(ずんだもん/ノーマル)` / `profile:owner-ja` のような narration-tts
   契約と同型の参照文字列）がそのまま入るだけであり、アバター ID を指す新フィールドは追加しない

## lane ごとの解決

| `voice.lane` | 解決先 | 承認ゲート | 備考 |
|---|---|---|---|
| `voicevox` | `--engine voicevox --speaker <ref から取り出した id>` | 不要（ゼロ円・宣言のみ。ハードルール 4 の対象外 — engines.md の voicevox アダプタと同じ） | `ref` の形式 `speaker:<id>(<名前>)` から先頭の整数を取り出して `--speaker` に渡す |
| `fal-clone` | `--engine fal-qwen3 --profile <ref から取り出した profile 名>` | **必要**（費用宣言 → 明示承認後のみ実行。ハードルール 4） | まず `--dry-run` で見積り費用を提示し、承認を得てから `--yes --apply` 相当を実行する。本人以外の声を無断で使わない（ハードルール 1 は generate-narration 本体が担保） |
| `recorded` | TTS 呼び出しなし | 該当なし | 人間が用意した音声ファイルをそのまま `audio.narration[].path` に置き、`provenance.provider: "human"` として記録する（generate-narration.mjs は使わない） |

`ref` の取り出し方（正規表現の目安）:

- `voicevox`: `ref` が `speaker:3(ずんだもん/ノーマル)` の形なら `speaker:` の直後から次の `(` まで
  の数字が `--speaker` の値
- `fal-clone`: `ref` が `profile:owner-ja` の形なら `profile:` の直後が `--profile` の値

## credit の転写

`voice.credit`（非 null のとき）は narration の `provenance.credit` へ転写する。

- **`voicevox` レーン**: `generate-narration.mjs` は生成のたびに VOICEVOX エンジンへ `/speakers`
  を問い合わせて話者名を解決し、`credit: "VOICEVOX:<話者名>"` を自動で `provenance` に埋める
  （[engines.md](engines.md#voicevox-アダプタ)）。通常はこの自動値がアバターの登録 `credit` と
  一致する（同じ speaker id を指しているため）。**一致することを確認し**、値が空でないことだけ
  検査すればよい（手で書き直す必要はない）
- **`fal-clone` レーン**: `generate-narration.mjs` の fal 経路は `credit` を `provenance` に
  自動で埋めない（自声クローンには通常クレジット義務が無いため）。もしアバターの `voice.credit`
  が非 null のまま fal-clone を使うケースがあれば（例外的な third-party クローン）、生成後の
  `entry.provenance.credit` にアバターの `voice.credit` を手動で追記してから `edit.json` へ
  反映し、`validate-edit.mjs` を再実行する

## 出力の確認

`--apply` を付けない場合、標準出力の `entry` JSON（`provenance` 含む）で `voice` / `credit` が
アバターの登録値と一致することを確認できる。`--apply` する場合は
[approvals-and-generation.md](../edit-plan/approvals-and-generation.md) のチェックポイント運用に
従う。
