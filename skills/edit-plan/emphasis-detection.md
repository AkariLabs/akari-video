# Derive word-level emphasis (emphasis_words)

> **v2 note**: edit.json v2 has an exact top level and rejects `emphasis_words`. Write `emphasis_words[]` at the object root of `captions.json`, not in v2 `edit.json`. See the [captions.json v0 word-level emphasis contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-23-captions-emphasis-words-v0.md).

Do not read all of `edit.json` / `captions.json`; grep by id and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). Write by targeted edit or edit-store script API.

## Principle

`emphasis_words[]` (user-facing **word-level emphasis**) is analysis recording which source words receive emphasis. The authoritative structure and validation duties are in the [captions.json v0 word-level emphasis contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-23-captions-emphasis-words-v0.md); record shape and selection rules continue the [edit.json v1 word-level emphasis contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-23-edit-json-v1-emphasis-words.md): `id` is unique within the file and matches `^e-\d{4}$`; `t_start` / `t_end` are source seconds with `t_end > t_start`; `word` is the transcript's actual spelling; `emotion` has six examples but no forced enum; `style_hint` is an optional suggestion; `src` is optional. This leaf defines **which words to choose** from validated `analysis.json` word times.

- **Input** is validated `analysis.json` `transcript[].words` ([analysis.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/analysis.schema.json) `$defs/word` = `start` / `end` / `text`).
- **Do not invent unsupported emphasis.** Each written word must refer to one actual `words` element. Do not write a candidate that cannot, following [beats.md](beats.md)'s evidence rule.
- **Word-level emphasis is the first-choice means for a moment of emotion or assertion** ([expression-selection.md](expression-selection.md)'s meaning-to-means table). Do not highlight words in a scene where this means was not selected.

## Input and target tiers (confirmed by 2026-07-23 measurement)

Several STT tiers produce `transcript[].words`, but **word matching success differs by tier**. The rules below come from a 2026-07-23 measurement of four tiers on the same 45-second Japanese monologue; they are measured, not guessed. The Japanese utterance examples and measured character counts remain in the language pack (see SKILL.md).

- **Never match words using whisper.cpp-tier `words`.** Even after contract normalization, dropping zero-duration tokens under the rule that a word without `end > start` must be discarded structurally removes short words from `words[]`; the concatenated text then differs from `segment.text`. Selecting a missing word would misalign `word` with actual speech and fail contract §4's requirement to preserve the transcript's actual spelling.
- **Do not write `emphasis_words` for an asset without `words` or whose concatenated words differ from `segment.text`.** Before derivation, compare the concatenation of that segment's `words[].text` in order with `segment.text`. On mismatch, **exclude the asset from word-level emphasis**. Record exclusion and reason in one editing-decision row ([decision-log.md](report-guide.md#decision_log)); do not silently leave it empty.
- **Early word starts were measured, but do not correct their times here.** Depending on the tier, word starts were measured up to **-0.92 seconds** before actual speech. The error sign was consistently negative; every outlier followed a pause or long nasal sound. Still **copy measured `words` times unchanged** into `t_start` / `t_end` (contract §4: do not invent timing inside a word). Display alignment (start snapping, offsets, look-ahead) is **the renderer's concern**. Do not shift times during derivation: doing so obscures whether the recognizer or renderer caused the mismatch.

## Selection rules

### 1. Narrow candidates

Candidates are limited to these four types. For content-language examples, see the language pack (see SKILL.md).

| Type | Example from the Japanese sample |
|---|---|
| Emotional expression | `やばい` / `うれしい` / `しんどかった` |
| Strong adjective or adverb | `最高` / `完全に` / `圧倒的に` |
| Core of a decisive line | One word central to a punchline or conclusion |
| Core of a numerical outcome | `90 秒` (90 seconds) / `3 倍` (threefold) |

**Do not select fillers, conjunctions, or particles.** Highlighting a word that does not carry the sentence's meaning gives viewers no useful focus. Use content-language examples from the language pack (see SKILL.md).

### 2. Prioritize highlight linkage

**Prioritize candidates within ±5 seconds of `emotion` / `punchline` / `reveal` in `beats[]`.** The motion grammar synchronizes word-level emphasis (③) with highlights (②); isolated word pops far from a highlight break that hierarchy.

- Measure distance in **source seconds** (`beats[].t` and `emphasis_words[].t_start` are both source seconds).
- Prioritize only `emotion` / `punchline` / `reveal`; `hook` / `turn` mark interval or chapter entries, not word-level synchronization targets.
- Adopt candidates outside highlights only when §3 density capacity remains, and still limit them to §1's four types.

### 3. Default density

- **At most three words per 60 seconds.**
- **One word per sentence (one `transcript` segment).**

Too many effects weaken the result. With multiple candidates in one sentence, choose the one closer under §2 and record the others as rejected candidates (§Evidence record).

> **Reserved control (no mapping defined)**: A future `direction { preset, intensity }` ([beat-sync.md](beat-sync.md)) may scale density, but this leaf defines no mapping. For now use the fixed defaults above.

## Assign emotion

Assign `joy` / `pain` / `surprise` / `anger` / `sadness` to `emotion`; use **`emphasis` for uncertain emphasis**. These are the six examples from contract §2; no enum is enforced, but do not invent vocabulary.

**Decide from context, not dictionary meaning.** The same word may express different emotions in different contexts.

| Utterance (context) | Target word | `emotion` | Reason |
|---|---|---|---|
| `うわ、やばい、これ完全に想定外です。` | `やばい` | `surprise` | Followed by `想定外` (unexpected): response to an unexpected event |
| `やばい、これめちゃくちゃ美味しい。` | `やばい` | `joy` | Followed by a positive evaluation of taste: expression of pleasure |

Do not assign `emotion` by looking up the word alone. Use **the same sentence and nearby speech**. If context supports more than one reading, fall back to `emphasis`; data that makes no emotional claim degrades less on the rendering side than data asserting the wrong emotion.

## style_hint guidance

`style_hint` **is only a suggestion; it does not bind the renderer** (contract §2 / §6; a consumer may ignore it without violating the contract). Omit it when uncertain. If used, follow this guidance.

| `emotion` | `style_hint` |
|---|---|
| `pain` / `surprise` / `anger` | `one-char-bang` |
| `joy` / `emphasis` | `size-pulse` |
| `sadness` or restrained context | `color-accent` |

Even for the same `emotion`, a quiet scene or calm delivery may use `color-accent`. Do not invent values outside the table; unknown values do not cause an error, but the renderer cannot interpret them and will ignore them.

## Evidence record

**`emphasis_words` has no evidence field corresponding to `basis`**, unlike `beats[]`. Record selection evidence outside the data.

- For each accepted word, record **word, reason, and corresponding beat or utterance** as **one row** in the asset plan of the editing decision record (`material` category in [decision-log.md](report-guide.md#decision_log)).
- Record rejected candidates too: density exclusions, words distant from highlights, and assets whose words cannot be matched. Use one row in the same format. Do not silently discard or include them (as in [beats.md](beats.md)'s v0 derivation guardrails).

## worked example

### Input (excerpt of `analysis.json`)

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

Assume this source uses the SpeechAnalyzer tier and all six segments have been checked: concatenated `words[].text` matches `segment.text`, passing the input/tier gate.

### Highlight candidates in the decision record (already derived under [beats.md](beats.md))

| id | `t` | `kind` | Source |
|---|---|---|---|
| `b-0001` | 12.05 | `hook` | Opening hook event |
| `b-0002` | 61.30 | `emotion` | Utterance `うわ、やばい、これ完全に想定外です。` |
| `b-0003` | 96.20 | `emotion` | Utterance `正直、この結果は最高でした。` |
| `b-0004` | 132.60 | `punchline` | Numerical outcome `処理時間は、12 分から 90 秒になりました。` |
| `b-0005` | 158.40 | `emotion` | Utterance `終わってみると、ほんとうに、しんどかった。` |

### Word-level emphasis written to `captions.json`

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

### Rules applied in this example

- **All times copy measured `words` values.** `e-0003` `t_start` 134.02 comes directly from `{ "start": 134.02, "end": 134.66, "text": "90 秒" }`, not apportionment of segment 132.60–135.30. `word` retains `"90 秒"` including its half-width space, rather than normalizing to `"90秒"`.
- **Highlight linkage**: all four are within ±5 seconds of an `emotion` or `punchline` beat (+0.32 / +1.20 / +1.42 / +1.45 seconds).
- **Emotion follows context**: `e-0001` `やばい` is `surprise` because `想定外` (unexpected) follows. `e-0003` `90 秒` is the core numerical outcome, not an emotion word, so it uses `emphasis` (it might suggest joy, but speech does not express pleasure; avoid asserting an emotion).
- **Density**: four words / 160 seconds. Every 60-second window has at most two words (neighbor gaps 35.78 / 36.62 / 25.83 seconds), under the three-word cap. Only one word per sentence was selected.

### One rejected example

| Word | Position | Reason for rejection |
|---|---|---|
| `想定外` | 62.95–63.55 (+1.65 seconds from `b-0002`) | ① **One word per sentence** (§3): `e-0001` `やばい` was already selected from the same segment, `うわ、やばい、これ完全に想定外です。` ② **Prioritize highlight linkage** (§2): relative to the same `emotion` beat at 61.30, `やばい` is +0.32 seconds and `想定外` +1.65, so choose the closer word. |

`想定外` (unexpected) qualifies as a strong adjective/adverb candidate under §1 and could otherwise be selected. Since the rules reject it, record it in `decision-log.md` as a rejected candidate.

For reference, the `decision-log.md` rows for `e-0001` through `e-0004` and the one rejection have this form; the fixed-format example retains Japanese contents.

```
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0001 | 採用 | 「やばい」= 感情表現。b-0002（emotion @61.30s）の +0.32 秒。発話『うわ、やばい、これ完全に想定外です。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0002 | 採用 | 「最高」= 強い形容。b-0003（emotion @96.20s）の +1.20 秒。発話『正直、この結果は最高でした。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0003 | 採用 | 「90 秒」= 数値実績の核。b-0004（punchline @132.60s）の +1.42 秒。発話『処理時間は、12 分から 90 秒になりました。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 e-0004 | 採用 | 「しんどかった」= 感情表現。b-0005（emotion @158.40s）の +1.45 秒。発話『終わってみると、ほんとうに、しんどかった。』 | エージェント | Checkpoint 2
2026-07-23T10:12+09:00 | material | 語レベル演出 不採用「想定外」 | 不採用 | 同一文内 1 語で e-0001「やばい」を採用済み。b-0002 からの距離も +1.65 秒で「やばい」より遠い | エージェント | Checkpoint 2
```

### v2 storage location

Write the above `emphasis_words[]` at the object root of `captions.json`, never paste it into v2 `edit.json`. Also record acceptance/rejection, measured `t_start` / `t_end`, word spelling, and evidence in `decision-log.md` as before.

## Validation

Check that each word-level candidate traces to `analysis.json` `words` and satisfies `t_end > t_start`; confirm adoption in `decision-log.md`. Check accepted results exist in `captions.json.emphasis_words[]`, not v2 `edit.json`.

**What validation does not do** (contract §7): do not rely on validation for these checks.

- It does not compare `word` / `t_start` / `t_end` with `analysis.json` word-level times. The input/tier and selection rules are **writer duties**; static validation lets them pass.
- It does not check whether times exceed actual media duration (media is not decoded without `--media`).
- It does not error on words outside every cut (zero projected occurrences is valid).

## Common mistakes

- Do not apportion `t_start` / `t_end` from segment times. **Use only measured `words` values.**
- Do not correct an early word start (up to -0.92 seconds) in the data. Correction belongs to rendering.
- Do not match `word` from whisper.cpp-tier `words`. If concatenation differs from `segment.text`, **exclude the asset from word-level emphasis**, write no `emphasis_words`, and record the reason.
- Do not normalize or reformat `word`, such as `90 秒` → `90秒` or standardize Japanese kana endings; that prevents matching back to the source.
- Do not select many words far from highlights just because density capacity remains. Prioritize ±5 seconds around `emotion` / `punchline` / `reveal`.
- Do not synchronize words to `hook` / `turn`; only `emotion` / `punchline` / `reveal` are word-level targets.
- Do not select fillers, conjunctions, or particles for emphasis; see language-specific examples in the language pack (see SKILL.md).
- Do not select two or more words from one sentence or four or more within 60 seconds.
- Assigning `emotion` from a dictionary meaning instead of **context** in the same and neighboring utterances.
- Forcing an emotion onto uncertain emphasis; use `emphasis` when uncertain.
- Treating `style_hint` as a required rendering directive; it is an optional suggestion.
- Silently discarding rejected candidates instead of recording them in `decision-log.md`.
- Assigning a non-sequential `id` such as `e-1` / `emphasis-0001`; `^e-\d{4}$` requires four zero-padded digits.
- Writing word-level emphasis into v2 `edit.json`; its home is `captions.json.emphasis_words[]`.
- Writing timeline seconds after cut concatenation in `t_start` / `t_end`; emphasis_words uses source seconds.
