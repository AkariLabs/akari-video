# 語レベル演出（emphasis_words）を導出する

## 原則

`emphasis_words[]`（人間向けの呼称は **語レベル演出**）は、素材のどの語を演出の対象にするかを
記録する解析結果である。データの器と検証責務の正は
[edit.json v1 語レベル演出契約](../../docs/contract-2026-07-23-edit-json-v1-emphasis-words.md) にある
（`id` は `^e-\d{4}$` でファイル内一意 / `t_start` / `t_end` は source 秒で `t_end > t_start` /
`word` は transcript の実表記 / `emotion` は例示 6 値で enum 強制なし / `style_hint` は任意の提案 /
`src` は v1 のみ）。本リーフはその器へ**どの語を選ぶか**、すなわち検証済み `analysis.json` の
word-level タイムスタンプから emphasis_words を導出する規約を定める。

- **入力**は検証済み `analysis.json` の `transcript[].words`（[analysis.schema.json](../../packages/schemas/analysis.schema.json)
  の `$defs/word` = `start` / `end` / `text`）。
- **根拠のない強調を発明しない**。書いたすべての語は、`words` の実要素を 1 つ指せなければならない。
  指せない候補は書かない（[beats.md](beats.md) の「根拠のない見せ場を発明しない」と同じ規律）。
- **語レベル演出は「感情・主張の瞬間」の第一候補の手段**である
  （[expression-selection.md](expression-selection.md) の意味 → 手段の対応表）。手段として選ばれて
  いないシーンで語だけ光らせない。

## 入力と対象 tier（2026-07-23 実測に基づく確定事項）

`transcript[].words` を出せる STT tier は複数あるが、**語照合の成否は tier で分かれる**。次は
2026-07-23 の 4 tier 実測（同一素材 45 秒・日本語独話）で確定した事項であり、推測ではない。

- **whisper.cpp tier の `words` では語照合をしない。** 規約どおりの正規化を通しても
  `words[]` の連結が `segment.text` と一致しない（171 → 160 文字・**11 文字欠落 = 6.4%**）。
  0 秒長 token を規約の「`end > start` を保てない word は捨てる」で落とすため、「後」「な」「つ」等の
  1 文字が構造的に消える。消えた語を強調対象に選べば `word` と実発話がずれ、契約 §4 の
  「transcript の実表記に忠実」を満たせない。
- **`words` が無い素材・連結が `segment.text` と一致しない素材では `emphasis_words` を書かない。**
  導出の前に「該当セグメントの `words[].text` を順に連結したものが `segment.text` と一致するか」を
  確認し、一致しなければその素材は**語レベル演出の対象外**とする。対象外にしたことと理由を
  編集判断レポート（[decision-log.md](report-guide.md#decision_log)）へ 1 行残す。黙って空にしない。
- **語頭の早出しは実測で存在するが、時刻は補正しない。** ポーズ直後の語頭は tier により最大
  **-0.92 秒**（実際の発声開始より 0.92 秒早い）ずれる実測がある。誤差の符号は一貫して負で、
  外れるのはすべて「直前にポーズまたは長い鼻音がある語頭」である。それでも `t_start` / `t_end` は
  **`words` の実測値をそのまま写す**（契約 §4「語の中間で発明しない」）。表示をどう合わせるか
  （語頭スナップ・オフセット・先読み）は**描画側の関心事**であり、本リーフはデータ側で先回りしない。
  時刻を導出段で動かすと、ずれの原因が認識器にあるのか描画側にあるのか切り分けられなくなる。

## 選定規則

### 1. 候補の絞り込み

候補は次の 4 種に限る。

| 種別 | 例 |
|---|---|
| 感情表現 | 「やばい」「うれしい」「しんどかった」 |
| 強い形容・副詞 | 「最高」「完全に」「圧倒的に」 |
| 決め台詞の核 | オチ・結論の中心となる 1 語 |
| 数値実績の核 | 「90 秒」「3 倍」 |

**フィラー・接続詞・助詞は選ばない**（「えー」「あの」「で」「が」「は」）。文全体の意味を担って
いない語を光らせても、視聴者の注意はどこにも向かない。

### 2. 見せ場連動を優先する

**`beats[]` の `emotion` / `punchline` / `reveal` の ±5 秒内にある候補を最優先する。**
③語レベルは②見せ場と同期する、が演出文法の原則であり、見せ場から離れた場所で語だけが跳ねると
演出の主従が壊れる。

- 距離は **source 秒**で測る（`beats[].t` も `emphasis_words[].t_start` も source 秒である）。
- 優先の対象は `emotion` / `punchline` / `reveal` の 3 種だけである。`hook` / `turn` は
  区間・章の入口を指すマーカーであり、語レベルの同期先ではない。
- 枠（§3 の密度）が余ったときに限り、見せ場外の候補を採ってよい。その場合も候補は §1 の 4 種に限る。

### 3. 密度既定

- **60 秒あたり最大 3 語**
- **同一文（`transcript` の 1 セグメント）内 1 語**

過多は演出をつぶす。同一文に候補が複数あるときは §2 の距離が近い方を採り、残りは不採用候補として
記録する（§根拠の記録）。

> **席（写像は定義しない）**: `direction { preset, intensity }`（[beat-sync.md](beat-sync.md)）に
> よる密度スケールの席は将来開くが、本リーフは写像を定義しない。現時点では上の既定値を固定で使う。

## emotion の割当

`emotion` には `joy` / `pain` / `surprise` / `anger` / `sadness` を割り当て、**判断に迷う強調は
`emphasis`** にする（契約 §2 の例示 6 値。enum 強制はされないが、語彙を勝手に増やさない）。

**語義でなく文脈で決める。** 同じ語が文脈によって違う感情になる。

| 発話（文脈） | 対象語 | `emotion` | 理由 |
|---|---|---|---|
| 「うわ、やばい、これ完全に想定外です。」 | やばい | `surprise` | 直後が「想定外」= 予期しない事態への反応 |
| 「やばい、これめちゃくちゃ美味しい。」 | やばい | `joy` | 直後が肯定評価 = 快の表明 |

語だけを辞書で引いて `emotion` を決めない。決めるのは**同じ文・直前直後の発話**である。
文脈からどちらとも取れる場合は `emphasis` に落とす（誤った感情を当てるより、感情を主張しない方が
描画側の劣化が小さい）。

## style_hint の目安

`style_hint` は**提案止まりであり、描画側に強制しない**（契約 §2 / §6。消費側が無視しても契約違反では
ない）。迷ったら省略してよい。付けるときの目安は次のとおり。

| `emotion` | `style_hint` |
|---|---|
| `pain` / `surprise` / `anger` | `one-char-bang` |
| `joy` / `emphasis` | `size-pulse` |
| `sadness`・控えめな文脈 | `color-accent` |

同じ `emotion` でも、静かな場面・落ち着いたトーンの発話では `color-accent` へ寄せてよい。
表に無い値を発明しない（未知値はエラーにならないが、描画側が解釈できず無視されるだけである）。

## 根拠の記録

**`emphasis_words` には `basis` に相当する根拠フィールドが無い**（`beats[]` との違い）。したがって
選定根拠はデータの外に残す。

- 採用した語ごとに、**語・理由・対応する beat または発話**を編集判断レポートの素材計画
  （[decision-log.md](report-guide.md#decision_log) の `material` category）へ **1 行ずつ**記録する。
- 不採用候補（密度で落とした語・見せ場から遠い語・語照合できない素材）も同じ形式で 1 行残す。
  黙って捨てない・黙って詰め込まないの両方を守る（[beats.md](beats.md) §v0 導出段のガードレールと同じ）。

## worked example

### 入力（`analysis.json` の断片）

```json
{
  "version": 0,
  "source": "assets/main.mp4",
  "transcript": [
    {
      "start": 12.05,
      "end": 14.30,
      "text": "正直、最初はうまくいくと思っていませんでした。",
      "words": [
        { "start": 12.05, "end": 12.48, "text": "正直" },
        { "start": 12.60, "end": 13.05, "text": "最初は" },
        { "start": 13.10, "end": 13.72, "text": "うまくいく" },
        { "start": 13.72, "end": 13.85, "text": "と" },
        { "start": 13.85, "end": 14.05, "text": "思って" },
        { "start": 14.05, "end": 14.30, "text": "いませんでした" }
      ]
    },
    {
      "start": 32.10,
      "end": 34.60,
      "text": "ここで問題が起きます。配線が届かない。",
      "words": [
        { "start": 32.10, "end": 32.48, "text": "ここで" },
        { "start": 32.48, "end": 32.95, "text": "問題が" },
        { "start": 32.95, "end": 33.40, "text": "起きます" },
        { "start": 33.60, "end": 34.05, "text": "配線が" },
        { "start": 34.05, "end": 34.60, "text": "届かない" }
      ]
    },
    {
      "start": 61.30,
      "end": 63.80,
      "text": "うわ、やばい、これ完全に想定外です。",
      "words": [
        { "start": 61.30, "end": 61.55, "text": "うわ" },
        { "start": 61.62, "end": 62.05, "text": "やばい" },
        { "start": 62.20, "end": 62.42, "text": "これ" },
        { "start": 62.42, "end": 62.90, "text": "完全に" },
        { "start": 62.95, "end": 63.55, "text": "想定外" },
        { "start": 63.55, "end": 63.80, "text": "です" }
      ]
    },
    {
      "start": 96.20,
      "end": 98.20,
      "text": "正直、この結果は最高でした。",
      "words": [
        { "start": 96.20, "end": 96.62, "text": "正直" },
        { "start": 96.70, "end": 96.90, "text": "この" },
        { "start": 96.90, "end": 97.35, "text": "結果は" },
        { "start": 97.40, "end": 97.92, "text": "最高" },
        { "start": 97.92, "end": 98.20, "text": "でした" }
      ]
    },
    {
      "start": 132.60,
      "end": 135.30,
      "text": "処理時間は、12 分から 90 秒になりました。",
      "words": [
        { "start": 132.60, "end": 132.98, "text": "処理" },
        { "start": 132.98, "end": 133.42, "text": "時間は" },
        { "start": 133.55, "end": 134.00, "text": "12 分から" },
        { "start": 134.02, "end": 134.66, "text": "90 秒" },
        { "start": 134.66, "end": 134.78, "text": "に" },
        { "start": 134.78, "end": 135.30, "text": "なりました" }
      ]
    },
    {
      "start": 158.40,
      "end": 160.61,
      "text": "終わってみると、ほんとうに、しんどかった。",
      "words": [
        { "start": 158.40, "end": 158.82, "text": "終わって" },
        { "start": 158.82, "end": 159.20, "text": "みると" },
        { "start": 159.35, "end": 159.80, "text": "ほんとうに" },
        { "start": 159.85, "end": 160.61, "text": "しんどかった" }
      ]
    }
  ]
}
```

この素材は SpeechAnalyzer tier で、6 セグメントとも `words[].text` の連結が `segment.text` と
一致することを確認済みとする（§入力と対象 tier のゲートを通過）。

### 同じ `edit.json` に既にある `beats`（[beats.md](beats.md) で導出済み）

| id | `t` | `kind` | 由来 |
|---|---|---|---|
| `b-0001` | 12.05 | `hook` | 冒頭の hook event |
| `b-0002` | 61.30 | `emotion` | 発話『うわ、やばい、これ完全に想定外です。』 |
| `b-0003` | 96.20 | `emotion` | 発話『正直、この結果は最高でした。』 |
| `b-0004` | 132.60 | `punchline` | 数値実績の提示『処理時間は、12 分から 90 秒になりました。』 |
| `b-0005` | 158.40 | `emotion` | 発話『終わってみると、ほんとうに、しんどかった。』 |

### 出力（`edit.json` の `emphasis_words`）

```json
{
  "emphasis_words": [
    {
      "id": "e-0001",
      "t_start": 61.62,
      "t_end": 62.05,
      "word": "やばい",
      "emotion": "surprise",
      "style_hint": "one-char-bang"
    },
    {
      "id": "e-0002",
      "t_start": 97.40,
      "t_end": 97.92,
      "word": "最高",
      "emotion": "joy",
      "style_hint": "size-pulse"
    },
    {
      "id": "e-0003",
      "t_start": 134.02,
      "t_end": 134.66,
      "word": "90 秒",
      "emotion": "emphasis",
      "style_hint": "size-pulse"
    },
    {
      "id": "e-0004",
      "t_start": 159.85,
      "t_end": 160.61,
      "word": "しんどかった",
      "emotion": "pain",
      "style_hint": "one-char-bang"
    }
  ]
}
```

### この例で働いた規則

- **時刻はすべて `words` の実測値の写し**である。`e-0003` の `t_start` 134.02 は
  `{ "start": 134.02, "end": 134.66, "text": "90 秒" }` そのものであり、セグメント時刻
  （132.60–135.30）から按分していない。`word` も `"90 秒"` と実表記どおり（半角スペース込み）で、
  `"90秒"` へ正規化していない。
- **見せ場連動**: 4 件とも `emotion` / `punchline` beat の ±5 秒内にある
  （+0.32 / +1.20 / +1.42 / +1.45 秒）。
- **emotion は文脈で決めた**: `e-0001` の「やばい」は直後の「想定外」から `surprise`。
  `e-0003` の「90 秒」は感情語ではなく数値実績の核なので `emphasis` に落とした
  （joy と読むこともできるが、発話に快の表明が無いため感情を主張しない側を採った）。
- **密度**: 4 語 / 160 秒。どの 60 秒窓を取っても最大 2 語（隣接間隔が 35.78 / 36.62 / 25.83 秒）で、
  上限 3 語に収まる。同一文からは 1 語だけを採っている。

### 不採用例（1 件）

| 語 | 位置 | 不採用の理由 |
|---|---|---|
| 想定外 | 62.95–63.55（`b-0002` の +1.65 秒） | ①**同一文内 1 語**（§3）— 同じセグメント『うわ、やばい、これ完全に想定外です。』から既に `e-0001`「やばい」を採用済み。②**見せ場連動を優先**（§2）— 同じ `emotion` beat（61.30）に対し「やばい」は +0.32 秒、「想定外」は +1.65 秒で、beat に近い「やばい」を採る。 |

「想定外」は §1 の「強い形容・副詞」に当たる正当な候補であり、規則が無ければ採用され得た。
規則で落としたので、`decision-log.md` へ不採用候補として残す。

参考までに、`e-0001`〜`e-0004` と不採用 1 件を記録した `decision-log.md` の行は次の形になる。

```
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0001 | 採用 | 「やばい」= 感情表現。b-0002（emotion @61.30s）の +0.32 秒。発話『うわ、やばい、これ完全に想定外です。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0002 | 採用 | 「最高」= 強い形容。b-0003（emotion @96.20s）の +1.20 秒。発話『正直、この結果は最高でした。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0003 | 採用 | 「90 秒」= 数値実績の核。b-0004（punchline @132.60s）の +1.42 秒。発話『処理時間は、12 分から 90 秒になりました。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0004 | 採用 | 「しんどかった」= 感情表現。b-0005（emotion @158.40s）の +1.45 秒。発話『終わってみると、ほんとうに、しんどかった。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 不採用「想定外」 | 不採用 | 同一文内 1 語で e-0001「やばい」を採用済み。b-0002 からの距離も +1.65 秒で「やばい」より遠い | エージェント | Checkpoint 2
```

### v0 / v1

上の `emphasis_words` を v0 サンプル（`version: 0` + 単一 `source`）へ足したファイルは
`validate-edit.mjs` / `edit-lint` の双方を PASS する（§検証に実測ログ）。v1（`sources[]`）で同じ
語を書く場合は各要素へ `"src": "s1"` のように `sources[].id` を足すだけでよく、`t_start` / `t_end` の
値は変えない。v0 では `src` の存在自体が検証エラーになるため書かない。

## 検証

書いた `emphasis_words` は既存の検証手順（[execution.md](execution.md) §4 の
[edit-lint](../edit-lint/SKILL.md) 実行）で `edit.json` ごと検証する。edit-lint は
`emphasis_words[]` の構造・`id` の一意性と形式・`t_end > t_start`・`src` の参照整合をエラーとして
弾き、`emphasis_words` の不在はエラーにしない。

上の worked example を v0 の `edit.json`（`beats` 込み）へ入れて実測した結果は次のとおり
（2026-07-23、一時ファイルで実行）。

```
$ node packages/schemas/bin/validate-edit.mjs <tmp>/edit.json
OK: <tmp>/edit.json
$ node packages/edit-lint/bin/edit-lint.mjs <tmp>/edit.json
PASS: <tmp>/edit.json (0 findings, 5 skipped)

# 同じ語へ "src": "s1" を足しただけの v1 版（sources[] / cuts[].src / beats[].src も v1 化）
$ node packages/schemas/bin/validate-edit.mjs <tmp>/v1/edit.json
OK: <tmp>/v1/edit.json
$ node packages/edit-lint/bin/edit-lint.mjs <tmp>/v1/edit.json
PASS: <tmp>/v1/edit.json (0 findings, 5 skipped)
```

同じ例で `e-0001.id` を `"e-1"` に、`e-0002.t_end` を `t_start` と同値に壊すと両者ともエラーで落ちる
（PASS が素通しでないことの確認）。

```
$ node packages/schemas/bin/validate-edit.mjs <tmp>/bad/edit.json
NG: <tmp>/bad/edit.json
- emphasis_words[0].id は e- に続く 4 桁の数字である必要があります
- emphasis_words[1].t_end は t_start より大きい必要があります
$ node packages/edit-lint/bin/edit-lint.mjs <tmp>/bad/edit.json
FAIL: <tmp>/bad/edit.json (2 findings, 5 skipped)
- [error] emphasis_words.id: id must match e- followed by four digits (edit.json#emphasis_words[0])
- [error] emphasis_words.range: t_end must be greater than t_start (edit.json#emphasis_words[1])
```

`edit-lint` は入力ファイル名が `edit.json` であることを要求する（別名だと `exit 2`）。一時検証でも
ファイル名は `edit.json` のままディレクトリを分ける。

**検証がしないこと**（契約 §7）。ここを検証に頼らない。

- `word` / `t_start` / `t_end` を `analysis.json` の word-level タイムスタンプと突き合わせない。
  §入力と対象 tier・§選定規則は**書き手が守る規律**であり、静的検証は素通しする。
- 時刻が素材の実尺を超えていないかを見ない（`--media` なしでメディアをデコードしない規律）。
- どの cut にも含まれない語をエラーにしない（射影結果 0 件は正常）。

## よくある間違い

- `t_start` / `t_end` をセグメント時刻から按分して作る。**`words` の実測値だけを使う**。
- 語頭の早出し（最大 -0.92 秒）をデータ側で補正して書く。補正は描画側の関心事である。
- whisper.cpp tier の `words` で語照合をして `word` を書く。連結が `segment.text` と一致しない
  素材は**語レベル演出の対象外**であり、`emphasis_words` を書かずにレポートへ記録する。
- `word` を正規化・整形して書く（「90 秒」→「90秒」、送り仮名の統一等）。参照元と突き合わせられなくなる。
- 見せ場から遠い語を density 枠が空いているという理由だけで大量に採る。優先は
  `emotion` / `punchline` / `reveal` の ±5 秒内である。
- `hook` / `turn` beat を語レベルの同期先に使う。同期先は `emotion` / `punchline` / `reveal` の 3 種。
- フィラー・接続詞・助詞（「えー」「で」「が」）を強調対象に選ぶ。
- 同一文から 2 語以上、または 60 秒に 4 語以上を採る。
- `emotion` を語義（辞書）で決める。決めるのは同じ文・直前直後の**文脈**である。
- 迷った強調に無理に感情を当てる。迷ったら `emphasis` に落とす。
- `style_hint` を描画への指定だと思って必須にする。提案止まりであり、省略してよい。
- 不採用候補を黙って捨て、`decision-log.md` に残さない。
- `id` を連番以外（`e-1` / `emphasis-0001` 等）で振る。`^e-\d{4}$` の 4 桁ゼロ埋めである。
- v0 の `edit.json` に `src` を書く（参照先が定義できないため検証エラー）。
- `t_start` / `t_end` に timeline 秒（cut 連結後の時刻）を書く。emphasis_words は source 秒である。
