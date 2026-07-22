# 見せ場マーカー（beats）を導出する

## 原則

`beats[]`（人間向けの呼称は **見せ場マーカー**）は、素材のどこに見せ場があるかという
**素材固有の事実**を記録する解析結果であり、編集で何を置いたかという結果ではない。
データの器と検証責務の正は
[edit.json v1 見せ場マーカー契約](../../docs/contract-2026-07-22-edit-json-v1-beats.md) にある
（`id` は `^b-\d{4}$` でファイル内一意 / `t` は source 秒 / `kind` は例示 5 種で enum 強制なし /
`strength` は `[0, 1]` / `basis` は任意 / `src` は v1 のみ）。本リーフはその器へ**何を書くか**、
すなわち検証済み `analysis.json` から beats を導出する規約を定める。

- **入力**は検証済み `analysis.json` の `events`（`hook` / `chapter` / `highlight`）と `transcript`。
- **根拠のない見せ場を発明しない**。書いたすべての beat は、analysis に対応する event または
  発話を指せなければならない。指せない候補は書かない。

## 既定マッピング表

| analysis 側 | beats.kind | strength |
|---|---|---|
| `hook` event | `hook` | hookScore の値をそのまま |
| `chapter` event | `turn` | 0.5 既定（章の重要度判断で ±0.2 まで調整可） |
| `highlight` event | `punchline` | score があればその値、なければ 0.6 |
| transcript の感情語・登場/種明かし表現（エージェント判断） | `emotion` / `reveal` | 0.5〜0.8。根拠発話を `basis` に引用 |

### スキーマとの突き合わせ（正規化）

`strength` は `[0, 1]` の連続値だが、[analysis.schema.json](../../packages/schemas/analysis.schema.json)
の該当フィールドは 1〜5 の整数尺度である。上表の「そのまま」「その値」は、次の決定的な
正規化を通した値を指す。独自の重み付けを発明せず、この式だけを使う。

| 元の値 | 正規化 | 例 |
|---|---|---|
| `hook` event の `score`（5 軸 `hook` / `self_contained` / `emotion` / `density` / `punch` を各 1〜5 で採点したオブジェクト。単一のスカラーではない） | `(5 軸合計 − 5) / 20`。小数第 2 位で丸める | 合計 21/25 → `0.8`。hook 候補登録の初期閾値 16/25 → `0.55` |
| `highlight` event の重要度（Schema 上のフィールド名は `score` ではなく `importance`。1〜5 の整数・任意） | `importance / 5` | `importance` 4 → `0.8`。`importance` 省略時は既定 `0.6` |
| `chapter` event | 尺度フィールドを持たない | 既定 `0.5`。章の重要度判断で ±0.2 まで調整してよい（調整したら理由を `basis` に書く） |

## 座標

- `t` は該当 event / 発話の **source 秒をそのまま**使う（timeline 秒へ変換して書かない）。
  区間を持つ event（`hook` / `highlight`）は `start` を `t` にする。
- マルチソース（v1）では `src` に該当素材の `sources[].id` を入れる。v0（単一 `source`）では
  `src` の存在自体が検証エラーになるため書かない。
- `overlays[].start` / `audio.bgm` / `audio.sfx` / `audio.narration[].t` が timeline 秒であることと
  対照的である。beats だけは source 秒であることを取り違えない。

## basis

- 由来を必ず書く（例: `"hookScore 0.82 @ 12.4s"` / `"発話『ついに来ました』"`）。
- 空の `basis` を量産しない。`basis` は任意フィールドだが、「後から誰が読んでも同じ analysis の
  同じ箇所へ戻れる」ことが見せ場マーカーの価値であり、省略はその価値を捨てることに等しい。
- 発話を引用するときは transcript の実発言に忠実に書く（要約・言い換えをしない）。

## v0 密度ガードレール

演出過多を防ぐための暫定既定である（D3 のツマミ導入までの暫定。素材ジャンルによる調整は
ツマミ側の仕事であり、ここで勝手に緩めない）。

- **60 秒あたり最大 2 件**
- **`strength < 0.6` は原則採用しない**（`hook` は例外的に 0.5 まで可）
- **同一 kind の連続は 20 秒以上空ける**

ガードレールを超える候補は「不採用候補」として編集判断レポート（現行運用では
[decision-log.md](report-guide.md#decision_log) への追記）に残し、`beats` には書かない。
黙って捨てない・黙って詰め込まないの両方を守る。

## worked example

### 入力（`analysis.json` の断片）

```json
{
  "version": 0,
  "source": "assets/main.mp4",
  "transcript": [
    { "start": 12.4, "end": 15.8, "text": "ついに来ました、今日はこれを全部お見せします。" },
    { "start": 96.2, "end": 99.5, "text": "正直、ここまで変わるとは思っていませんでした。" }
  ],
  "events": [
    {
      "type": "hook",
      "start": 12.4,
      "end": 24.0,
      "score": { "hook": 5, "self_contained": 4, "emotion": 4, "density": 4, "punch": 4 }
    },
    { "type": "chapter", "t": 48.0, "title": "セットアップ手順" },
    {
      "type": "highlight",
      "start": 132.0,
      "end": 138.5,
      "quote": "処理時間は 12 分から 90 秒になりました。",
      "reason": "導入効果を数値で提示（数値・実績）",
      "importance": 4
    }
  ]
}
```

### 出力（`edit.json` の `beats`）

```json
{
  "beats": [
    {
      "id": "b-0001",
      "t": 12.4,
      "kind": "hook",
      "strength": 0.8,
      "basis": "hook event 12.4–24.0s / 5 軸合計 21/25 → 0.8。発話『ついに来ました、今日はこれを全部お見せします。』"
    },
    {
      "id": "b-0002",
      "t": 48.0,
      "kind": "turn",
      "strength": 0.7,
      "basis": "chapter event『セットアップ手順』@ 48.0s。本編の入口として既定 0.5 から +0.2"
    },
    {
      "id": "b-0003",
      "t": 96.2,
      "kind": "emotion",
      "strength": 0.7,
      "basis": "発話『正直、ここまで変わるとは思っていませんでした。』@ 96.2s"
    },
    {
      "id": "b-0004",
      "t": 132.0,
      "kind": "punchline",
      "strength": 0.8,
      "basis": "highlight event importance 4『処理時間は 12 分から 90 秒になりました。』@ 132.0s"
    }
  ]
}
```

この `beats` を v0 サンプル（`version: 0` + 単一 `source`）へ足したファイルは
`validate-edit.mjs` / `edit-lint` の双方を PASS する。v1（`sources[]`）で同じ beats を書く場合は
各要素へ `"src": "s1"` のように `sources[].id` を足すだけでよく、`t` の値は変えない。

### この例で働いたガードレール

- 60 秒あたり最大 2 件: どの 60 秒窓を取っても採用は 2 件以内（12.4 / 48.0 / 96.2 / 132.0）。
- `strength < 0.6` 不採用: `chapter` の既定 0.5 のままでは採用できないため、章の重要度判断で
  +0.2 して 0.7 とし、その理由を `basis` に残した。調整の余地がない章はそもそも書かない。
- **不採用候補**: 発話「ついに来ました、今日はこれを全部お見せします。」（12.4s）は `emotion`
  候補にもなり得るが、同一時刻の `hook`（b-0001）と `turn`（b-0002）で 60 秒窓の上限 2 件に
  達しているため不採用とし、`decision-log.md` に不採用候補として残した。

## 検証

書いた beats は既存の検証手順（[execution.md](execution.md) §4 の
[edit-lint](../edit-lint/SKILL.md) 実行）で `edit.json` ごと検証する。edit-lint は `beats[]` の
構造・`id` の一意性・`src` の参照整合をエラーとして弾き、`beats` の不在はエラーにしない。

## よくある間違い

- `t` に timeline 秒（cut 連結後の時刻）を書く。beats だけは source 秒である。
- v0 の edit.json に `src` を書く（参照先が定義できないため検証エラー）。
- hook の 5 軸スコアをスカラーだと思い込み、1〜5 の整数をそのまま `strength` に入れる（範囲外）。
- 根拠の指せない「盛り上がりそうな箇所」を beats に足す。
- `basis` を空にする、または「重要」「盛り上がり」のような由来を復元できない語で埋める。
- ガードレールを超えた候補を黙って捨て、不採用候補として記録しない。
- `id` を連番以外（`b-1` / `beat-0001` 等）で振る。`^b-\d{4}$` の 4 桁ゼロ埋めである。
