# 見せ場マーカー（beats）を導出する

> **v2 注記**: edit.json v2 のトップレベルは exact で `beats` を受け付けない。
> 以下の導出知識は見せ場候補と根拠を判断記録へ残すために使い、v2 の `edit.json` には書かない。
> `beats` は v2 で廃止済みであり、消費者側コードも畳んだため、今後も復活させない。

`edit.json` / `captions.json` は全文 Read せず、id で grep して該当行だけ読む（[edit.json の読み方](../../docs/guides/edit-json-access.md)）。
書き込みは該当行の Edit か edit-store のスクリプト API を使う。

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
| `highlight` event **または** transcript のオチ・決め台詞・数値実績の提示（エージェント判断） | `punchline` | highlight 由来: score があればその値、なければ 0.6<br>transcript 由来: 0.5〜0.8。根拠発話を `basis` に引用 |
| transcript の感情語・登場/種明かし表現（エージェント判断） | `emotion` / `reveal` | 0.5〜0.8。根拠発話を `basis` に引用 |

`punchline` の供給源を transcript へ広げたのは、**`highlight` event が 0 件の素材では
`punchline` が原理的に 1 件も生まれない**という実測が dogfood であったためである。transcript
由来の `punchline` は `emotion` / `reveal` の行と同型に扱う（0.5〜0.8・根拠発話を `basis` に引用）。
highlight 由来の strength は従来どおり正規化表に従う。

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
- item の `at` が出力フレームであることと
  対照的である。beats だけは source 秒であることを取り違えない。

## basis

- 由来を必ず書く（例: `"hookScore 0.82 @ 12.4s"` / `"発話『ついに来ました』"`）。
- 空の `basis` を量産しない。`basis` は任意フィールドだが、「後から誰が読んでも同じ analysis の
  同じ箇所へ戻れる」ことが見せ場マーカーの価値であり、省略はその価値を捨てることに等しい。
- 発話を引用するときは transcript の実発言に忠実に書く（要約・言い換えをしない）。

## v0 導出段のガードレール（下限と根拠だけ）

導出段で課すのは次の 2 つだけである（D3 のツマミ導入までの暫定。素材ジャンルによる調整は
ツマミ側の仕事であり、ここで勝手に緩めない）。

- **`strength < 0.5` は書かない**（下限）
- **根拠必須**（§basis。analysis の event または発話を指せない候補は書かない）

下限を割る候補は「不採用候補」として編集判断レポート（現行運用では
[decision-log.md](report-guide.md#decision_log) への追記）に残し、`beats` には書かない。
黙って捨てない・黙って詰め込まないの両方を守る。

### 密度は導出段で課さない（発火段へ移した）

「60 秒あたり最大 2 件」「同一 kind の連続は 20 秒以上空ける」の 2 つは、以前は本リーフの
導出段にあったが**削除した**。適用先は発火段（[beat-sync.md](beat-sync.md) §評価順の「密度
ガードレール」）であり、**射影後の timeline 秒**で数える。

理由は 2 つある。

- `beats` は**素材固有の事実**であり、演出過多の抑制は「素材にいくつ見せ場があるか」ではなく
  「出力にいくつ演出を置くか」の問題である。関心事が違うものを同じ段で混ぜない。
- 導出段（source 秒）で密度を課すと、**カットで消える区間の beat が密度枠を消費し、生き残る
  べき発火を押し出す**。この取りこぼしは dogfood で実測された。射影後に数えれば、落とした
  区間の見せ場は枠を消費しない。

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

### 判断記録へ残す見せ場候補（旧 `beats` 形は根拠の構造例としてのみ使用）

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
      "basis": "chapter event『セットアップ手順』@ 48.0s。章の入口として既定 0.5 から +0.2"
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
    },
    {
      "id": "b-0005",
      "t": 12.4,
      "kind": "emotion",
      "strength": 0.6,
      "basis": "発話『ついに来ました、今日はこれを全部お見せします。』@ 12.4s。冒頭の高揚を hook とは別に感情の山として記録"
    }
  ]
}
```

この JSON 片は v2 の `edit.json` へ貼り付けない。採用・不採用と `basis` を
`decision-log.md` へ残し、演出を作るときの入力として使う。

### この例で働いたガードレール

- `strength < 0.5` 不採用: 5 件とも 0.6 以上で下限を満たす。`chapter` の既定 0.5 は下限ちょうどで
  採用可だが、ここでは章の重要度判断で +0.2 して 0.7 とし、その理由を `basis` に残した。
- 根拠必須: 5 件とも analysis の event か transcript の発話を指しており、`basis` から同じ箇所へ
  戻れる。指せない「盛り上がりそうな箇所」は 1 件も書いていない。
- **密度は数えていない**: `b-0005`（12.4s の `emotion`）は同一 60 秒窓に `hook`（12.4s）と
  `turn`（48.0s）があり、旧規則（導出段の 60 秒 2 件）なら不採用だった候補である。改訂後は
  下限と根拠を満たす限り**素材の事実として書く**。演出過多の抑制は発火段が担い、この beat は
  [beat-sync.md](beat-sync.md) の worked example で強度ゲートに落ちて無音の見せ場になる。
- **不採用候補**: 下限 0.5 を割る候補（例: 相槌・言い淀みだけを根拠にした `emotion` 候補）は
  `beats` に書かず、`decision-log.md` に不採用候補として残す。

## 検証

見せ場候補は `analysis.json` の event / transcript へ戻れるかを検証し、採用判断を
`decision-log.md` で確認する。v2 の `edit.json` へは書かない。

## よくある間違い

- `t` に timeline 秒（cut 連結後の時刻）を書く。beats だけは source 秒である。
- v0 の edit.json に `src` を書く（参照先が定義できないため検証エラー）。
- hook の 5 軸スコアをスカラーだと思い込み、1〜5 の整数をそのまま `strength` に入れる（範囲外）。
- 根拠の指せない「盛り上がりそうな箇所」を beats に足す。
- `basis` を空にする、または「重要」「盛り上がり」のような由来を復元できない語で埋める。
- 下限 0.5 を割る候補を黙って捨て、不採用候補として記録しない。
- 導出段で密度（60 秒あたり 2 件・同一 kind の 20 秒間隔）を課して beats を間引く。密度は発火段
  （[beat-sync.md](beat-sync.md)）の関心事であり、**射影後の timeline 秒**で数える。source 秒で
  数えると、カットで消える区間の beat が枠を消費して生き残るべき発火を押し出す。
- `highlight` event が 0 件だからと `punchline` を 1 件も書かずに終える（transcript のオチ・
  決め台詞・数値実績の提示も供給源である）。
- `id` を連番以外（`b-1` / `beat-0001` 等）で振る。`^b-\d{4}$` の 4 桁ゼロ埋めである。
