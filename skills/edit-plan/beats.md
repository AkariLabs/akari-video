# Derive highlight markers (beats)

> **v2 note**: edit.json v2 has an exact top level and rejects `beats`. Use the derivation rules below to record highlight candidates and evidence in the decision record, not v2 `edit.json`. `beats` was retired in v2 and removed from consumer code; do not restore it.

Do not read all of `edit.json` / `captions.json`; grep by id and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). Write by targeted edit or the edit-store script API.

## Principle

`beats[]` (called **highlight markers** in user-facing language) is analysis recording **source-specific facts** about where highlights occur, not the edit's placement results. The authoritative structure and validation duties are in the [edit.json v1 highlight-marker contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-22-edit-json-v1-beats.md): `id` matches `^b-\d{4}$` and is unique in the file; `t` is source seconds; `kind` has five examples but no forced enum; `strength` is `[0, 1]`; `basis` is optional; `src` exists only in v1. This leaf specifies **what to write** there by deriving beats from validated `analysis.json`.

- **Input** is validated `analysis.json` `events` (`hook` / `chapter` / `highlight`) and `transcript`.
- **Do not invent unsupported highlights.** Every recorded beat must point to a corresponding analysis event or utterance. Do not record a candidate that cannot.

## Default mapping table

| Analysis source | beats.kind | strength |
|---|---|---|
| `hook` event | `hook` | Normalized hookScore value |
| `chapter` event | `turn` | Default 0.5 (may adjust by up to ±0.2 based on chapter importance) |
| `highlight` event **or** transcript punchline, decisive line, or numerical outcome (agent judgment) | `punchline` | From highlight: normalized score if present, otherwise 0.6<br>From transcript: 0.5–0.8; quote supporting speech in `basis` |
| Emotional words or entrance/reveal in transcript (agent judgment) | `emotion` / `reveal` | 0.5–0.8; quote supporting speech in `basis` |

Transcript became a `punchline` source after dogfooding showed that **assets with zero `highlight` events otherwise can never produce a `punchline`**. Handle transcript-derived `punchline` like `emotion` / `reveal` (0.5–0.8, supporting utterance quoted in `basis`). Highlight-derived strength still follows the normalization table.

### Reconcile with the schema (normalization)

`strength` is continuous over `[0, 1]`, while corresponding fields in [analysis.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/analysis.schema.json) are integers from 1 to 5. "Value" in the table above means the value after the following deterministic normalization. Do not invent weights; use only these formulas.

| Original value | Normalization | Example |
|---|---|---|
| `hook` event `score` (an object with five axes, `hook` / `self_contained` / `emotion` / `density` / `punch`, each 1–5; not one scalar) | `(5 軸合計 − 5) / 20` (sum of five axes minus five, divided by 20), rounded to two decimal places | Sum 21/25 → `0.8`; initial hook-candidate registration threshold 16/25 → `0.55` |
| `highlight` importance (schema field `importance`, not `score`; optional integer 1–5) | `importance / 5` | `importance` 4 → `0.8`; default `0.6` if omitted |
| `chapter` event | No scale field | Default `0.5`; may adjust up to ±0.2 based on chapter importance (write the reason in `basis`) |

## Coordinates

- Use the event or utterance's **source seconds unchanged** for `t`; do not convert to timeline seconds. For interval events (`hook` / `highlight`), use `start` as `t`.
- For multi-source v1, put the asset's `sources[].id` in `src`. Do not write `src` for v0 (one `source`); its presence causes validation failure.
- This differs from item `at`, which is in output frames. Beats alone use source seconds.

## basis

- Always record provenance (for example, `"hookScore 0.82 @ 12.4s"` / `"発話『ついに来ました』"` (an utterance quotation)).
- Do not mass-produce empty `basis` values. Although optional, `basis` lets any future reader return to the same analysis location; omitting it loses the highlight marker's value.
- When quoting speech, use the actual transcript wording, not a summary or paraphrase.

## v0 derivation guardrails (floor and evidence only)

Apply only these two rules at derivation (temporary until D3 controls exist; genre-specific adjustment belongs to those controls, so do not relax the rules here).

- **Do not write `strength < 0.5`** (floor).
- **Evidence is required** (§basis; do not write a candidate without a matching analysis event or utterance).

Keep below-floor candidates as rejected candidates in the editing decision record (currently an append to [decision-log.md](report-guide.md#decision_log)), not in `beats`. Neither silently discard nor silently include them.

### Do not enforce density at derivation (moved to triggering)

The former derivation limits of "at most two per 60 seconds" and "at least 20 seconds between successive instances of the same kind" were **removed** here. Apply them at the trigger stage ([beat-sync.md](beat-sync.md), density guardrail under evaluation order), counting **post-projection timeline seconds**.

There are two reasons:

- `beats` are **source-specific facts**; limiting effects concerns how many effects appear in the output, not how many highlights the source contains. Do not mix these concerns in one stage.
- Density at derivation (source seconds) lets **a beat in a cut-away interval consume capacity and displace a trigger that survives**. Dogfooding measured this omission. Counting after projection prevents removed intervals from consuming capacity.

## worked example

### Input (excerpt of `analysis.json`)

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

### Highlight candidates for the decision record (old `beats` shape illustrates evidence structure only)

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

Do not paste this JSON excerpt into v2 `edit.json`. Record acceptance/rejection and `basis` in `decision-log.md` and use them as input for effects.

### Guardrails applied in this example

- Reject `strength < 0.5`: all five are at least 0.6. The `chapter` default of 0.5 meets the floor, but this example raises it by +0.2 to 0.7 for chapter importance and explains that in `basis`.
- Evidence required: all five point to an analysis event or transcript utterance; `basis` returns to the same location. No unsupported "potentially exciting" location is written.
- **Density was not counted**: `b-0005` (12.4s `emotion`) shares a 60-second window with `hook` (12.4s) and `turn` (48.0s), so the old two-per-60-second derivation rule would reject it. Under the revision, write it **as a source fact** if floor and evidence pass. The trigger stage limits effects; this beat fails the intensity gate in [beat-sync.md](beat-sync.md)'s worked example and remains a silent highlight.
- **Rejected candidate**: a candidate below 0.5 (for example, `emotion` supported only by an acknowledgment or hesitation) goes in `decision-log.md` as rejected, not in `beats`.

## Validation

Verify each highlight candidate can be traced to an `analysis.json` event or transcript and check adoption in `decision-log.md`. Do not write it into v2 `edit.json`.

## Common mistakes

- Writing timeline seconds (after cut concatenation) into `t`; beats use source seconds.
- Writing `src` in v0 edit.json; there is no referent, so validation fails.
- Treating a hook's five-axis score as one scalar and putting an integer 1–5 directly into `strength`, outside its range.
- Adding a "potentially exciting" beat without traceable evidence.
- Leaving `basis` empty or filling it with provenance-free words such as "important" or "exciting."
- Silently dropping candidates below the 0.5 floor instead of recording their rejection.
- Thinning beats during derivation using density (two per 60 seconds, 20 seconds between the same kind). Density belongs to triggering ([beat-sync.md](beat-sync.md)) and uses **post-projection timeline seconds**. Counting source seconds lets cut-away beats displace surviving triggers.
- Ending with zero `punchline` beats merely because there are zero `highlight` events; transcript punchlines, decisive lines, and numerical outcomes are also sources.
- Assigning a non-sequential `id` such as `b-1` / `beat-0001`; `^b-\d{4}$` requires four zero-padded digits.
