---
name: beat-sync-edit
description: 宣言済み音源（declarations.json の BPM・頭拍・キメ・区間）を唯一の時刻ソースにして、拍にスナップした edit.json とオーバーレイ一式を「生成器」から機械生成する制作スキル。音に合わせて画面が動く PV・ハイライト・ショーケースを、手打ちの秒数ゼロで作る。「リズムに合わせて動画を作って」「この曲で PV を作って」「拍に合わせて切り替えたい」「音に反応するモーションにして」で発動。宣言づけ自体は declare-audio（別物）、素材ゼロからの企画は edit-plan（別物）。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる。

次のいずれかに違反する形で進めない。詳細リーフより常に優先する。

1. **時刻を手で打たない。** カット・オーバーレイ・SFX のすべての時刻は、宣言（BPM・頭拍・
   キメ・区間）から計算した拍位置に置く。「だいたい 12 秒くらい」で置いた瞬間に音とズレる。
2. **`edit.json` を手で編集しない。** 生成器（`gen-timeline.mjs`）が唯一の組み立て器である。
   直しは生成器を直して再実行する。手で直すと次の再生成で消える。
3. **宣言が無い音源で始めない。** `declarations.json` に BPM・`beat_offset_s` が無ければ、
   まず [declare-audio](../declare-audio/SKILL.md) で人が耳で付ける。自動推定値を実測と偽らない。
4. **フルレンダーを検証手段にしない。** 絵の確認は**ミニプロジェクト**（数秒）で回す
   （[verify-loop.md](verify-loop.md)）。1 周 40 秒 と 40 分の差が、品質の差になる。
5. **レンダー完了を実出力ファイルで確認する。** ログの `PASS` だけで完了を報告しない。
   `exports/` の実体と `ffprobe` を見る。
6. **「動いている」を静止画 1 枚で判断しない。** モーションは**連続する 3 点以上**を撮って
   確かめる（開始・中間・終了）。特に 3D は既定ポーズの意味を推測で決めない。

# この型が向いているもの

| 向いている | 向いていない |
|---|---|
| 音楽が主・尺が音源で決まる（PV / ショーケース / ハイライト） | 喋りが主（→ [edit-plan](../edit-plan/SKILL.md)） |
| 切り替えが多い（数十〜数百の演出） | カット数が少なく手で置ける |
| 同じ構成を音源違いで作り直す | 一点物で再生成しない |

# 実行順

1. **宣言を読む** — `declarations.json` から BPM / `beat_offset_s` / `hit_points` / `sections`。
   無ければ [declare-audio](../declare-audio/SKILL.md) へ（人の手番）
2. **ビートマップを作る** — 拍グリッド + 拍ごとの音量（音反応モーションの材料）。
   → [generator.md](generator.md) §1
3. **構成を宣言の区間に割り付ける** — `sections` のラベル（intro/build/drop/bridge/outro）が
   そのまま構成の骨。ドロップに山場を置く。→ [generator.md](generator.md) §2
4. **生成器を書く** — オーバーレイ HTML と `edit.json` を機械生成する。
   → [generator.md](generator.md) §3〜§5
5. **lint** — `node packages/edit-lint/bin/edit-lint.mjs <project>` が PASS するまで
6. **ミニ検証** — 疑わしい断片だけを数秒のプロジェクトで焼いて目視 → [verify-loop.md](verify-loop.md)
7. **本レンダー** — 負荷待ち + タイムアウト延長で焼く → [verify-loop.md](verify-loop.md) §3
8. **検収** — 見せ場ごとにフレームを抜いて目視 + `ffprobe` + ラウドネス → [verify-loop.md](verify-loop.md) §4
9. **レビュー反映** — 指摘は生成器の 1 箇所を直して再実行 → [verify-loop.md](verify-loop.md) §5

# なぜ生成器から作るのか

- **音とズレない**: 全時刻が同じ拍グリッドから出るので、1 発でも手打ちがあると
  そこだけズレる。生成器なら構造的にズレない
- **直しが速い**: 「文字が小さい」→ 定数 1 つ。「この音がダサい」→ 1 行差し替え。
  数十箇所に散らばった手打ちを追いかけない
- **音源を差し替えられる**: 宣言が変われば全体が追従する
- **記録が残る**: 生成器そのものが「どういう設計か」の説明になる

# リーフ目次

- 生成器の書き方（ビートマップ・区間割り付け・オーバーレイ・音反応）: [generator.md](generator.md)
- 検証ループ（ミニ検証・レンダー運用・検収・レビュー反映）: [verify-loop.md](verify-loop.md)
- 落とし穴集（実測で踏んだもの一覧）: [pitfalls.md](pitfalls.md)

# 道具

| 道具 | 用途 |
|---|---|
| [`templates/gen-timeline.mjs`](templates/gen-timeline.mjs) | 生成器のひな形（そのままコピーして書き換える） |
| `akari internal beat-sync-beatmap` | 宣言 + 音源 → 拍グリッド + 拍別音量 + 波形エンベロープ |
| `akari internal beat-sync-probe-frame` | 本番と同じシートから任意時刻を 1 枚だけ撮る |
| `akari internal beat-sync-render-when-idle` | マシンが空くのを待ってからレンダーする |

関連: [overlay-authoring](../overlay-authoring/SKILL.md)（断片の書き方）/
[declare-audio](../declare-audio/SKILL.md)（宣言づけ）/ [render-cut](../render-cut/SKILL.md)（書き出し）
