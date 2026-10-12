# Connect highlight markers to effects (beats → SFX triggers)

The library defaults to workspace `library/`; without a workspace use legacy `~/.akari/assets/`. Check the actual location on the first line of `akari-assets list` (or `akari assets list`). Below, `<ライブラリの置き場>` means the displayed library path; audio is under its `audio/` directory.

> **v2 note**: edit.json v2 has an exact top level and rejects `beats` / `direction`. Read highlight candidates and intensity from the decision record; do not write these keys to v2 `edit.json`. Both were retired in v2 and removed from consumer code; do not restore them. Output only effects placed in `tracks[].items[]`.

Do not read all of `edit.json` / `captions.json`; grep by id and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). Write by targeted edit or edit-store script API.

These rules turn approved `beats[]` highlight markers into sound and motion at highlights using only existing `edit.json` vocabulary. [beats.md](beats.md) defines how to **derive and record** highlights; this leaf defines how to **consume** them.

The [edit.json v1 highlight-marker contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-22-edit-json-v1-beats.md) §6 explicitly leaves actual triggered effects outside its scope for a separate consumer contract. This leaf is v0 of that consumer rule and follows the two invariants the contract imposes on consumers: source-second anchors and degradation behavior.

## v0 scope (owner-approved; do not expand here)

- Use **only the existing library** for SFX. Do not acquire or download new sounds.
- There is no contracted visual-transition `edit.json` vocabulary. Compose v0 simultaneous events from **SFX + cut boundary + overlay decoration**; do not invent dedicated transition fields.
- Respect the BGM default of "opening and ending only" and **do not manipulate BGM in response to beats**. Ducking remains the existing narration-driven mechanism; beat-driven BGM changes await controls.
- Creating new dedicated visual components such as outlines or glitter is out of scope; proposing existing overlay components is allowed.

## Input

- Input is **human-approved `beats[]`**, passing [beats.md](beats.md)'s derivation floor `strength` 0.5 and evidence requirement. **Do not build effects from unapproved beats.**
- Density (count per 60 seconds and spacing of the same kind) is not enforced at derivation. **This leaf must control excessive effects** using the post-projection timeline-second density guardrail under §Evaluation order.
- Approval means a record in `decision-log.md` ([report-guide.md](report-guide.md#decision_log)). Do not treat inactivity, timeout, or past blanket approval as approval now.
- **Effect strength comes from the approved `preset` / `intensity` decision in `decision-log.md`.** Derive all effect numbers below from it (§Effect presets and `intensity` mapping). Without `direction`, use the old default behavior, `youtube-long-standard` plus `intensity` 50.

## Projection — source seconds to timeline seconds

`beats[].t` is in **source seconds** ([beats.md](beats.md) §Coordinates / beats contract §3). Compute trigger positions from visual-track media items each time; do not write projected results back into highlight candidates.

- Project a highlight candidate's source seconds through media item `source.in/out` and `at` to output frames as its **trigger position**.
- Use [execution.md](execution.md) §2's projection formula: for source time `s` within keep range `[in, out)`, `timeline = （それ以前の keep-range 長の合計） + (s - in)` (sum of earlier keep-range lengths plus `s - in`).
- For a **one-to-many** projection (same beat/source interval occurs more than once on the timeline), **trigger once per occurrence**.
- A beat with **zero projected positions has no trigger** (its interval was cut). This is normal, neither error nor warning (beats contract §4).

## Effect presets and `intensity` mapping

Effect numbers here (strength gate, density, suggested `gain_db`, ritual snap window) are **deterministically** derived from approved `preset` / `intensity` in `decision-log.md`, not fixed. Do not write `direction` into v2 `edit.json`. **This section is authoritative for the mapping.**

### Actual preset parameters (at `intensity` = 50)

| Parameter | `youtube-long-standard` | `shorts-high-energy` | `calm-explainer` |
|---|---|---|---|
| Strength gate | 0.8 | 0.7 | 0.9 |
| Density: maximum per 60 seconds | 2 | 4 | 1 |
| Density: spacing of same kind | 20 seconds | 10 seconds | 30 seconds |
| `gain_db` reference (standard row of guideline table) | -6 | -4 | -8 |
| Ritual snap window | ±1.0 seconds | ±1.0 seconds | ±0.5 seconds |

`preset` is not an enum (contract §2 / §3). An unknown `preset` not in the table falls back to **default behavior** below. Do not add presets beyond these three; expansion requires an owner ruling and separate contract.

### `intensity` mapping (deterministic across all presets)

Let `i` be `intensity` in the decision record (integer `[0, 100]`, reference 50), and `base` the table value above. Then:

| Parameter | Mapping | Notes |
|---|---|---|
| Strength gate | `gate = base - (i - 50) * 0.002` | +0.1 at `i=0`, -0.1 at `i=100`; clamp to `[0.5, 0.95]` |
| Maximum per 60 seconds | `max = round(base * (0.5 + i / 100))` | Half at `i=0`, 1.5× at `i=100`; minimum 1 |
| Same-kind interval | `interval = base * (1.5 - i / 100)` seconds | 1.5× at `i=0`, 0.5× at `i=100` |
| Three guideline `gain_db` values | `各値 + (i - 50) * 0.04` dB (each value plus the expression) | +2 dB at `i=100`, -2 dB at `i=0`; clamp to `[-60, 12]` |
| Ritual snap window | **No mapping**; keep preset-specific value | Ritual does not change with `intensity` |

- `round` means round half up (`.5` goes to the larger integer). Clamp mapped count to at least 1.
- Do not round intermediate calculations; round only display precision in the report.
- The mapping is **monotone**: as `i` rises, the strength gate falls, maximum count rises, same-kind spacing shrinks, and `gain_db` rises. None reduces triggering, so **for identical input (same `beats[]` and visual media items), SFX count is nondecreasing in `i`**; it cannot fall, though it need not increase.

### Default when `direction` is missing or invalid

When `direction` is missing or its entire declaration is ignored under degradation rules (contract §5), apply **`preset` = `youtube-long-standard` plus `intensity` = 50** (the same default as contract §5). The first table column then yields gate 0.8, maximum 2 per 60 seconds, same-kind spacing 20 seconds, standard `gain_db` -6, and ritual snap ±1.0 seconds. **These equal the fixed values before `direction` was introduced**, preserving behavior.

### Values independent of `intensity`

The following do not change with `intensity`:

- **Ritual snap window**, kept preset-specific without mapping.
- **Ritual priority over strength gate and density**: never drop a successfully ritual-snapped `turn` for density.
- **One SFX within ±0.5 seconds of a time**: both window and "retain higher `strength`" priority are fixed.
- **Evaluation order itself**: projection → ritual snap → strength gate → density → ±0.5-second limit → ascending append.

## Evaluation order (deterministic)

Process in this order so identical highlight candidates and visual media items always produce identical audio items.

1. **Project** every beat to timeline seconds (zero-occurrence beats drop here).
2. **Chapter-turn ritual**: If a `turn` projection is within the **ritual snap window** of a cut boundary, snap to that boundary (window from §Effect presets and `intensity` mapping; default ±1.0 seconds).
3. **Music-grid snap**: **Only when declared BGM is present**, align triggers not already ritual-snapped to musical hits, downbeats, or beats (§Music-grid snapping; default window ±0.12 seconds).
4. **Strength gate**: Keep SFX only for beats whose `strength` is at least the **strength-gate value** (derived from §Effect presets and `intensity` mapping; default 0.8). A `turn` ritual-snapped in step 2 takes priority and must not be dropped by this gate; see §Chapter-turn ritual.
5. **Density guardrail**: On **projected timeline seconds**, apply maximum triggers per 60 seconds and minimum spacing of successive same-kind triggers (values derived from §Effect presets and `intensity` mapping; default 2 / 20 seconds; see §Density guardrail).
6. **Near-simultaneous limit**: For two or more SFX within ±0.5 seconds of the same time, keep the beat with higher `strength`.
7. **Write** surviving triggers to `audio.sfx[]` in ascending timeline seconds.

The order is **projection → ritual snap → music-grid snap → strength gate → density → ±0.5-second limit → ascending append**. Music-grid snap comes **after** ritual so a beat shift of tens of milliseconds cannot break a synchronized visual/audio turn.

## Music-grid snapping (only with declared BGM)

**Purpose**: Put triggers **on musical beats**, not approximately nearby. Even tens of milliseconds of mismatch can make SFX sound pasted on. Apply this stage only when the BGM has ear-verified declarations of BPM, first downbeat, and accent hits.

### Prerequisites (skip this entire stage if unmet)

- A track is specified at `audio.bgm.path` in `edit.json`.
- That track **has a declaration** (keyed by filename stem in `<ライブラリ>/declarations.json`).
- **Do not guess**: never analyze or infer BPM here for undeclared BGM. If the user wants a declaration, point to [declare-audio](../declare-audio/SKILL.md); for purchased tracks, point to `akari store install sounds-declaration-pack`. Do not align to an invented beat.
- **A declaration may still be wrong.** `tempo_flag` measures **compliance with requested BPM** during generation, not alignment of declaration to actual audio. Check `grid_flag` for that. Mistaking `tempo_flag: ok` for verified grid alignment caused all 579 broken declarations to go unnoticed (`2026-08-19-audio-beatgrid-declaration-audit`).

### Obtain the grid (do not calculate it yourself)

Declaration seconds are **song-local seconds**, not timeline seconds. The CLI handles `audio.bgm.in` (cue point) and loops. **Do not calculate the conversion by hand.**

```sh
node packages/audio-library-setup/bin/beat-grid.mjs --edit <edit.json> --timeline <全長秒> \
  --snap 12.0,20.5 --window 0.12 --json
```

- Output `grid.hits` / `grid.downbeats` / `grid.beats` / `grid.seams` / `grid.sections[].start_frame` and `end_frame` are **all timeline frame numbers**, not timeline seconds. Output timing and duration use integer frames for both video and audio (2026-08-19 unit ruling). The CLI computes a seconds grid internally, then returns `toFrameGrid` conversion. Divide by `fps` when writing timeline-second fields such as `audio.sfx[].t`.
- `grid.seams` marks **loop seams**, where the song jumps from end to beginning. The beat becomes unstable there; **do not trigger near a seam (about ±0.3 seconds in frames)** because it will not sound musically placed.
- `grid.sections` gives song structure, including chorus. **Do not enforce density tightly within a chorus**, where highlights may cluster. Restrain it normally in `intro` / `break`.

### Snap rules

- **Priority: accent `hits` > measure `downbeats` > `beats`.** Among points in the window, choose the nearest; break ties toward the earlier one (deterministic).
- **Default window ±0.12 seconds.** Outside it, **do not move** the trigger. For tightly paced effects such as `shorts-high-energy`, the window may narrow to ±0.08 seconds.
- **Do not move a ritual-snapped trigger** (reason for evaluation order).
- Move **only** `audio.sfx[].t`. Do not rewrite source-anchored `beats[].t` (contract invariant, same as ritual snap).
- **Do not touch BGM at all.** v0's no beat-driven BGM manipulation remains in force; effects align to music, not the reverse.

### Align cuts to beats (photo changes)

For a slideshow such as `beatslide` with photos changing on beats, use the same CLI's `cut_candidates` as **asset-plan proposals** (default: every measure, four beats).

- Adoption requires Checkpoint 2 / 3 approval. **Do not pour candidates directly into visual items.**
- Source duration limits cut length. If trimming to a beat candidate, follow [execution.md](execution.md)'s cut rules; do not invent source material to satisfy a beat.

### Record

For music-snapped triggers, record **shift amount and target type** in the corresponding `decision-log.md` row.

```text
sfx b-0003 | 射影 31.42s → 音楽スナップ 31.38s（hit / -0.04s） | 宣言: bgm-beatslide-124-001
```

## Density guardrail

These rules prevent excessive effects. **Derive numbers from `direction { preset, intensity }`** (§Effect presets and `intensity` mapping). Genre or distribution-channel adjustment belongs in the `direction` declaration; do not relax values here on your own.

- **Maximum count per 60 seconds** (**2** at default preset and `i=50`).
- **Successive triggers of the same kind must be at least the same-kind interval apart** (**20 seconds** at default preset and `i=50`).

Apply them as follows:

- **Count in projected timeline seconds.** Source-second counting lets beats in cut-away intervals consume capacity and displace surviving triggers (measured in dogfooding; hence the rule moved from [beats.md](beats.md)'s derivation to this trigger stage).
- When over capacity, **retain higher `strength`**; break ties toward earlier timeline seconds for determinism.
- **Do not drop a ritual-snapped `turn` for density**, for the same reason it bypasses the strength gate: that would prevent a synchronized chapter turn. Include it in the density count, but choose drops from non-ritual triggers.
- Record density-dropped triggers as rejected candidates in the editing decision record ([decision-log.md](report-guide.md#decision_log)). Do not remove their beats from `beats[]`; they remain **silent highlights**.

## SFX trigger rules

- Append `{ path, t: <射影後 timeline 秒>, gain_db }` to `audio.sfx[]`. **Default `gain_db` is the guideline table's standard row** (§`gain_db` guidance: **-6** for default preset and `i=50`). `audio.sfx[].t` is **timeline seconds** ([audio contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-14-edit-json-v1-audio.md) §1); `gain_db` clamps to `[-60, 12]`.
- **Near-simultaneous limit**: at most one SFX within ±0.5 seconds of a time; prefer higher `strength`. This window does not depend on `intensity`.
- **Density guardrail**: apply maximum per 60 seconds and minimum same-kind interval in post-projection timeline seconds (§Density guardrail; default 2 / 20 seconds).
- **Attach SFX only to beats with `strength` at least the strength gate** (0.8 at default preset and `i=50`). Lower beats remain **silent highlights**. Do not remove them from beats; omitting SFX is an effect decision, not a judgment that the highlight vanished.

### `gain_db` guidance

The table is for **`youtube-long-standard` at `intensity` = 50** (the default with missing `direction`). Choose among these scene-sensitive guidelines:

| Condition | `gain_db` |
|---|---|
| `strength >= 0.9` or a ritual impact at the hook | -4 |
| Standard | -6 |
| `emotion` kind, quiet scene, or second successive trigger | -8 |

**Changing preset changes the standard row** (`shorts-high-energy` -4 / `calm-explainer` -8; §Actual preset parameters). Keep the other two rows at +2 / -2 dB relative to standard. Then add `(i - 50) * 0.04` dB to all three for `intensity` (§Mapping). Examples for the default preset:

| `i` | Addition | -4 row | Standard row | -8 row |
|---|---|---|---|---|
| 30 | -0.8 dB | -4.8 | -6.8 | -8.8 |
| 50 | ±0 dB | -4 | -6 | -8 |
| 80 | +1.2 dB | -2.8 | -4.8 | -6.8 |

The audio contract's `[-60, 12]` clamp still applies. Other values are allowed only with one-line rationale in the editing report; the **three mapped values** are defaults requiring no rationale.

## Chapter-turn ritual (turn beat)

If a projected `turn` lies **within the ritual snap window of a cut boundary** (§Effect presets and `intensity` mapping; ±1.0 seconds for default preset, ±0.5 for `calm-explainer`; **not changed by `intensity`**), **snap** SFX `t` to that boundary for simultaneous audio and visual change. A `turn` **farther from boundaries follows ordinary rules**: keep its projected position and apply the strength gate normally.

- Cut boundaries are the timeline-second starts of all keep ranges (including initial 0) plus timeline end.
- Snapping affects only `audio.sfx[].t`; do not rewrite source-anchored `beats[].t`.
- **Ritual takes priority over the strength gate.** Ordinary rules for a distant `turn` mean a near-boundary `turn` is exceptional. Under [beats.md](beats.md)'s default mapping, a `chapter` event gives `turn` strength 0.5 ±0.2 (at most 0.7); if ritual depended on the strength gate, `turn` SFX could never fire. To preserve synchronized sound and image at chapter changes, snap-trigger any `turn` inside the window without passing it through the strength gate. **Keep this v0 interpretation** after `direction` adoption: ritual is independent of `intensity`, surviving even minimum effects, consistent with contract §4's `intensity` = 0, "minimal effects (ritual only)." Revision requires an owner ruling.

## Default SFX table (kind → existing SFX)

### Search layers and availability (measured 2026-07-22)

Follow [report-guide.md](report-guide.md#asset-plan)'s full search order: project `assets/` → parent `.akari/assets/` → `<ライブラリの置き場>/` → product repository `assets/` → `catalog/`. Measurements on 2026-07-22 were:

| Layer | Contents | Status |
|---|---|---|
| Product repository `assets/audio/` | Only `INDEX.md` (no assets yet) | **Unfilled** for every kind |
| `catalog/audio/` (15 packs) | Only `meta.json`; all `"remote": true` | **Unfilled** (references only; no binaries by rule) |
| User library `<ライブラリの置き場>/audio/` (10 packs, 340 files) | Actual audio files | **Filled** (paths below refer here) |

Thus **the product repository has zero actual SFX, and its layer leaves all five kinds unfilled**. Table defaults are real files in the user library; without that layer the default table is empty. **Acquisition for missing kinds or environments belongs to [setup-audio-library](../setup-audio-library/SKILL.md); do not choose replacement audio on your own here.**

### Default table

Paths are relative to `<ライブラリの置き場>/audio/`. `catalog/audio/<pack-id>/meta.json` is authoritative for license and credit requirements; values below were checked against it.

| kind | Sound character | Default SFX (real paths in priority order) | License | Credit | Status |
|---|---|---|---|---|---|
| `hook` | Strong impact | `soundeffect-lab-ambient-life-pack/和太鼓でドン.mp3`<br>`soundeffect-lab-anime-direction-pack/シャキーン1.mp3` | LicenseRef-SoundEffectLab-Free | Optional | Filled (library layer) |
| `turn` | Swish/whoosh | `soundeffect-lab-anime-direction-pack/シュッ！.mp3`<br>`soundeffect-lab-anime-direction-pack/シーン切り替え1.mp3` | LicenseRef-SoundEffectLab-Free | Optional | Filled (library layer) |
| `punchline` | Pop/confirmation | `soundeffect-lab-ui-signal-pack/決定ボタンを押す1.mp3`<br>`soundeffect-lab-ui-signal-pack/決定ボタンを押す26.mp3` | LicenseRef-SoundEffectLab-Free | Optional | Filled (library layer) |
| `reveal` | Sparkle/chime | `soundeffect-lab-anime-direction-pack/きらーん1.mp3`<br>`musmus-onomatope-sfx-pack/チャイム.mp3` | LicenseRef-SoundEffectLab-Free<br>LicenseRef-MusMus-Free | First optional<br>second **required** (MusMus below) | Filled (library layer) |
| `emotion` | Soft pop; no harsh impact | `otologic-motion-pop-sfx-pack/Motion-Pop19-1.mp3`<br>`soundeffect-lab-anime-direction-pack/パッ.mp3` | CC-BY-4.0<br>LicenseRef-SoundEffectLab-Free | First **required** (OtoLogic below)<br>second optional | Filled (library layer) |
| `fail` | Mistake/disappointment | `soundeffect-lab-ui-signal-pack/チーン1.mp3`<br>`pocket-se-fail-pack/deden.mp3` | LicenseRef-SoundEffectLab-Free<br>LicenseRef-PocketSound-Free | First optional<br>second **required** (Pocket Sound below) | Filled (library layer) |
| `wrong` | Incorrect/NG | `soundeffect-lab-ui-signal-pack/クイズ不正解1.mp3`<br>`maoudamashii-se-onepoint-category/ワンポイント33.mp3` | LicenseRef-SoundEffectLab-Free<br>LicenseRef-MaouDamashii-Free | First optional<br>second **required** (Maou Damashii below) | Filled (library layer) |
| `correct` | Correct/affirmative | `soundeffect-lab-ui-signal-pack/クイズ正解2.mp3`<br>`soundeffect-lab-ui-signal-pack/クイズ正解3.mp3` | LicenseRef-SoundEffectLab-Free | Optional | Filled (library layer) |
| `question` | Question/uncertainty | `dova-syndrome-hatena-mark-se/はてなマーク.mp3` | LicenseRef-DOVA-SYNDROME-Free | Optional | Filled (library layer) |

`kind` is not an enum (beats contract §2). A beat whose `kind` is absent from the table has no default SFX; keep it as a silent highlight or propose an SFX in chat as part of the asset plan and obtain approval.

2026-07-31 revision: added four rows, `fail` / `wrong` / `correct` / `question`, based on per-file tags from the owner's complete listening review (sfx-review). The provider describes first-choice `fail` file `チーン1` as an effect for disappointment; **never use it to signal completion or confirmation** (a prior misuse prompted this rule). Each library pack's `index.jsonl` records per-file use and non-use contexts; consult it at selection. The same revision removed the former second `punchline` choice (MusMus pop) by owner decision and replaced it with SoundEffectLab `決定ボタンを押す26` (official description: pop image).

### Select by context (default priority remains)

The **mechanically fixed default is always the first item** in priority order. **Within the same kind row and among license-checked options, you may select a second or later item, or a different item, when scene tone or avoiding repetition of the previous SFX provides a reason. Record that reason in one line of editing-report selection evidence (deviation without a reason is forbidden; the first item is the default).**

- Choose **only within the same kind row**; do not borrow from another kind.
- If a later choice belongs to a pack with `attribution_required: true`, adoption creates a credit-text obligation (§Credit required on adoption). License-checked means this obligation was checked too.
- Example reasons: the first `hook` taiko already sounded at 4.4 seconds, so choose the second scene-change sound for `turn` at 22.0 to avoid repetition; or choose the second light pop for `emotion` in a quiet monologue.

### Credit text required on adoption of `attribution_required: true`

On adoption, include the following text verbatim in the editing report's credits. Use the `meta.json` `ai_usage` wording unchanged; do not summarize or paraphrase it.

| Pack | Credit text |
|---|---|
| `musmus-onomatope-sfx-pack` | `BGM:MusMus` (full form: `フリーBGM・音楽素材 MusMus https://musmus.main.jp`) |
| `otologic-motion-pop-sfx-pack` | `音：OtoLogic（https://otologic.jp/）` |
| `pocket-se-fail-pack` | `効果音：ポケットサウンド – https://pocket-se.info/` (a link is also allowed) |
| `maoudamashii-se-onepoint-category` (and other Maou Damashii packs) | `音楽：魔王魂（https://maou.audio/）` |

Credit is optional for `attribution_required: false` packs (SoundEffectLab and DOVA-SYNDROME). However, SoundEffectLab, MusMus, and OtoLogic all **forbid redistributing assets alone**. Copying adopted SFX into the project is allowed, but **never commit them to a public repository**.

### Import into the project and paths

`audio.sfx[].path` may be relative to edit.json or absolute (audio contract §2). For portability, default to copying adopted SFX to project `assets/audio/<pack-id>/<file>` and **reference them by relative path**, following [execution.md](execution.md) §2's same-tree rule. An absolute library path is allowed when not copying, but the project loses portability.

## Overlay decoration options

At a highlight, visual treatment is limited to **the cut-boundary change itself plus proposed existing overlay components** (telop / motion categories).

- Select existing components from [overlay-authoring](../overlay-authoring/SKILL.md)'s categories; propose them in chat and obtain asset-plan (Checkpoint 2) approval.
- **Do not create components or invent transition vocabulary.** Do not add uncontracted `transition` fields to `edit.json` or create dedicated outline/glitter components.
- If placing an HTML item, align its `at` output frame with SFX (for a ritual-snapped `turn`, use the snapped boundary frame).

## worked example

### Input 1 — `beats[]` (exact output of [beats.md](beats.md)'s worked example)

| id | kind | `t` (source seconds) | strength |
|---|---|---|---|
| `b-0001` | `hook` | 12.4 | 0.8 |
| `b-0002` | `turn` | 48.0 | 0.7 |
| `b-0003` | `emotion` | 96.2 | 0.7 |
| `b-0004` | `punchline` | 132.0 | 0.8 |
| `b-0005` | `emotion` | 12.4 | 0.6 |

### Input 2 — Visual media items (three keep ranges)

```json
{
  "tracks": [{
    "id": "v1", "lane": "visual", "items": [
      { "id": "clip-1", "at": 0, "duration": 660,
        "source": { "kind": "media", "src": "s1", "in": 8.0, "out": 30.0 } },
      { "id": "clip-2", "at": 660, "duration": 384,
        "source": { "kind": "media", "src": "s1", "in": 47.2, "out": 60.0 } },
      { "id": "clip-3", "at": 1044, "duration": 180,
        "source": { "kind": "media", "src": "s1", "in": 94.0, "out": 100.0 } }
    ]
  }]
}
```

Keep-range lengths are 22.0 / 12.8 / 6.0 seconds. Timeline intervals and boundaries are:

| item | source `[in, out)` | timeline `[開始, 終了)` (start, end) |
|---|---|---|
| `clip-1` | `[8.0, 30.0)` | `[0.0, 22.0)` |
| `clip-2` | `[47.2, 60.0)` | `[22.0, 34.8)` |
| `clip-3` | `[94.0, 100.0)` | `[34.8, 40.8)` |

Cut-boundary set = `{ 0.0, 22.0, 34.8, 40.8 }` (timeline length 40.8 seconds).

### Projection and ritual (independent of `intensity`)

Projection and ritual snapping do not depend on `direction` (`intensity` does not change the default preset's ±1.0-second ritual window). These steps are common to all three cases.

| beat | Containing cut | Earlier keep-range total | `t - in` | Projected timeline seconds | Distance to nearest boundary | Ritual |
|---|---|---|---|---|---|---|
| `b-0001` `hook` 0.8 | `cuts[0]` | 0.0 | `12.4 - 8.0 = 4.4` | **4.4** | `4.4 - 0.0 = 4.4` | Inapplicable (not `turn`) |
| `b-0002` `turn` 0.7 | `cuts[1]` | 22.0 | `48.0 - 47.2 = 0.8` | 22.8 | `22.8 - 22.0 = 0.8 ≤ 1.0` | **Applies → snap to 22.0** |
| `b-0003` `emotion` 0.7 | `cuts[2]` | 34.8 | `96.2 - 94.0 = 2.2` | **37.0** | `37.0 - 34.8 = 2.2` | Inapplicable (not `turn`) |
| `b-0004` `punchline` 0.8 | None (`132.0` outside all keep ranges) | — | — | — | — | — |
| `b-0005` `emotion` 0.6 | `cuts[0]` | 0.0 | `12.4 - 8.0 = 4.4` | **4.4** | `4.4 - 0.0 = 4.4` | Inapplicable (not `turn`) |

`b-0004` has **zero projections** and does not trigger at any later `intensity` (normal).

### Compare `intensity` 30 / 50 / 80 (`preset` = `youtube-long-standard`)

Mapped parameters (intermediate calculations from §`intensity` mapping):

| Parameter | `i=30` | `i=50` | `i=80` |
|---|---|---|---|
| Strength gate `0.8 - (i-50)*0.002` | `0.8 - (-20)*0.002 =` **0.84** | `0.8 - 0*0.002 =` **0.8** | `0.8 - 30*0.002 =` **0.74** |
| Maximum per 60 seconds `round(2*(0.5+i/100))` | `round(2*0.8) = round(1.6) =` **2** | `round(2*1.0) =` **2** | `round(2*1.3) = round(2.6) =` **3** |
| Same-kind interval `20*(1.5-i/100)` | `20*1.2 =` **24 seconds** | `20*1.0 =` **20 seconds** | `20*0.7 =` **14 seconds** |
| Standard `gain_db` row `-6 + (i-50)*0.04` | `-6 - 0.8 =` **-6.8** | **-6** | `-6 + 1.2 =` **-4.8** |
| Ritual snap window (not mapped) | ±1.0 seconds | ±1.0 seconds | ±1.0 seconds |

Strength-gate outcomes and triggers in each case:

| Beat (projected) | `i=30` (gate 0.84) | `i=50` (gate 0.8) | `i=80` (gate 0.74) |
|---|---|---|---|
| `b-0001` `hook` 0.8 @ 4.4 | 0.8 < 0.84 → **fail** | 0.8 ≥ 0.8 → pass | 0.8 ≥ 0.74 → pass |
| `b-0002` `turn` 0.7 @ 22.0 (ritual applies) | Ritual priority → **trigger** | Ritual priority → **trigger** | Ritual priority → **trigger** |
| `b-0003` `emotion` 0.7 @ 37.0 | 0.7 < 0.84 → fail | 0.7 < 0.8 → fail | 0.7 < 0.74 → fail |
| `b-0004` `punchline` 0.8 | Zero projections | Zero projections | Zero projections |
| `b-0005` `emotion` 0.6 @ 4.4 | 0.6 < 0.84 → fail | 0.6 < 0.8 → fail | 0.6 < 0.74 → fail |
| **Triggered SFX** | 22.0 `turn` | 4.4 `hook` / 22.0 `turn` | 4.4 `hook` / 22.0 `turn` |
| **Count** | **1** | **2** | **2** |

Density check: `i=30` has one trigger, `i=50` two (exactly its cap of two), and `i=80` two (below its cap of three). Any 60-second window on this 40.8-second timeline stays within the cap. No case has successive triggers of the same kind (`hook` and `turn` differ), so intervals of 24 / 20 / 14 seconds are not violated. Zero triggers fall to density in all three cases.

Near-simultaneous check: at `i=50` / `i=80`, triggers at 4.4 and 22.0 are 17.6 seconds apart, so both survive the ±0.5-second rule. `b-0005` projects to 4.4 like `b-0001`, but fails the earlier strength gate in all cases. If it had passed, higher-strength `b-0001` would survive.

**Monotonicity check**: SFX counts are **1 (`i=30`) ≤ 2 (`i=50`) ≤ 2 (`i=80`)**, nondecreasing. No increase at `i=50 → 80` occurs because there is no beat with `strength` in `[0.74, 0.8)` (next is 0.7), even though the gate falls to 0.74. A monotone mapping need not increase counts each time; increasing `i` cannot lower them.

Each case uses the standard `gain_db` row (-6.8 / -6 / -4.8): strength 0.8 is below 0.9 and the 4.4-second `hook` is not ritual-snapped, so the -4 row does not apply. Every SFX uses the first item in its default row; no contextual deviation means no extra selection-rationale row.

### Output — v2 `edit.json` (`i=50` highlights)

Keep `preset` / `intensity` and highlight candidates in `decision-log.md`, not at the v2 top level. Write only effect results as audio-track items. Example at 30fps:

```json
{
  "version": 2,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "sources": [
    { "id": "s1", "path": "source.mp4" },
    { "id": "se1", "path": "assets/audio/和太鼓でドン.mp3" }
  ],
  "tracks": [
    {
      "id": "a1", "lane": "audio",
      "items": [
        { "id": "se-hook", "at": 132, "duration": 30,
          "source": { "kind": "media", "src": "se1", "in": 0, "out": 1 } }
      ]
    },
    {
      "id": "v1", "lane": "visual",
      "items": [
        { "id": "clip-1", "at": 0, "duration": 660,
          "source": { "kind": "media", "src": "s1", "in": 8, "out": 30 } }
      ]
    }
  ]
}
```

For `i=30` / `i=80`, only the decision record changes; update only the count, position, and gain of adopted effect items in v2 vocabulary.

### Validation (measured 2026-07-23 / three `intensity` values)

Each of the three cases was validated in a separate temporary project's `edit.json`, with real SFX placed in `assets/audio/<pack-id>/` (`analysis.json` contained only `duration: 180`; `source.mp4` was real; all three projects used the same asset structure).

```
$ node packages/schemas/bin/validate-edit.mjs <tmp>/proj-i30/edit.json
OK: <tmp>/proj-i30/edit.json                          # exit 0 / 0.097s
$ node packages/edit-lint/bin/edit-lint.mjs <tmp>/proj-i30
PASS: <tmp>/proj-i30 (0 findings, 4 skipped)          # exit 0 / 0.125s

$ node packages/schemas/bin/validate-edit.mjs <tmp>/proj-i50/edit.json
OK: <tmp>/proj-i50/edit.json                          # exit 0 / 0.107s
$ node packages/edit-lint/bin/edit-lint.mjs <tmp>/proj-i50
PASS: <tmp>/proj-i50 (0 findings, 4 skipped)          # exit 0 / 0.135s

$ node packages/schemas/bin/validate-edit.mjs <tmp>/proj-i80/edit.json
OK: <tmp>/proj-i80/edit.json                          # exit 0 / 0.093s
$ node packages/edit-lint/bin/edit-lint.mjs <tmp>/proj-i80
PASS: <tmp>/proj-i80 (0 findings, 4 skipped)          # exit 0 / 0.104s
```

Those PASS results also confirm mapped `gain_db` values -6.8 / -4.8 lie within the audio contract's `[-60, 12]` clamp. Path resolution was checked by temporarily removing one SFX, producing one `[warning] audio.sfx.file: sfx path does not resolve to a regular file: ...`, then restoring it to return to zero findings.

## Validation

Validate written `audio.sfx[]` with the existing `edit.json` procedure, [edit-lint](../edit-lint/SKILL.md) in [execution.md](execution.md) §4. edit-lint checks:

- Negative or nonfinite `audio.sfx[].t` is an error; beyond timeline length is a warning.
- `audio.sfx[].gain_db` outside `[-60, 12]` is an error.
- `audio.sfx[].path` failing to resolve to a real file is a warning (audio is decorative and does not determine video export success, per audio contract §5 degradation). **Do not leave even this warning unresolved**: exporting with a wrong or unfetched path yields silence.

## Common mistakes

- Building SFX from `beats[]` before approval.
- Copying source seconds (`beats[].t`) into `audio.sfx[].t`, which requires timeline seconds.
- Writing projected times back into `beats[].t`; beats are source facts and must not bake in a value that changes with cuts.
- Treating a zero-projection beat as a missed trigger and changing cuts just to make it sound; a cut-away highlight normally has no trigger.
- Adding SFX to a beat below the strength gate (below 0.8 at default preset and `i=50`), causing excessive effects. Silent highlights are the default.
- Using gate 0.8, density 2 per 60 seconds / 20-second spacing, and ±1.0-second snap as fixed values without checking `preset` / `intensity` in `decision-log.md`. Derive them from the approved choice; they equal old fixed values only for default preset and `i=50`.
- Interpreting `intensity` qualitatively as vaguely stronger or weaker. Apply the §`intensity` formulas and record intermediate calculations.
- **Estimating BPM for undeclared BGM and snapping to it.** Without a declaration, skip music-grid snapping entirely and, if needed, point to declare-audio or the declaration pack.
- **Treating declaration seconds (song-local) as timeline seconds.** `audio.bgm.in` and loops shift them. Use `bin/beat-grid.mjs`; do not calculate by hand.
- **Writing `grid.hits` / `grid.downbeats` / `grid.beats` / `grid.seams` directly into `audio.sfx[].t` as though they were timeline seconds.** They are timeline **frame numbers** (2026-08-19 unit ruling); divide by `fps` for a timeline-second field.
- **Triggering at a loop seam** around `grid.seams`; even a nominally aligned beat will not sound right there.
- **Reading `tempo_flag: ok` as "the grid is correct."** `tempo_flag` measures requested-BPM compliance only; use `grid_flag` for alignment with actual audio.
- Moving `beats[].t` during music snapping or manipulating BGM (`audio.bgm`) to fit beats. Move only `audio.sfx[].t`; BGM manipulation is outside v0 scope.
- Scaling the ritual snap window with `intensity` or dropping a ritual-snapped `turn` when `intensity` falls. Ritual is independent and survives at `intensity` = 0.
- Stopping export because decision-record values are corrupt. Degradation discards them and uses `youtube-long-standard` plus `intensity` 50.
- Layering SFX within ±0.5 seconds; retain only the beat with higher `strength`.
- Moving `beats[].t` to a boundary for `turn`; move only `audio.sfx[].t`.
- Counting density in **source seconds** (`beats[].t`), rather than projected timeline seconds; cut-away beats must not consume capacity.
- Thinning beats at derivation in [beats.md](beats.md); beats are source facts, so thin triggers instead.
- Dropping a ritual-snapped `turn` for density; chapter ritual takes priority.
- Silently dropping a density-rejected trigger without recording it in `decision-log.md`.
- Reordering evaluation (such as applying the ±0.5-second limit before density). Fixed order is projection → ritual snap → strength gate → density → ±0.5-second limit → ascending append.
- Adopting a second or later default-table SFX without a one-line selection rationale. Unexplained deviation is forbidden; the first is default.
- Borrowing sound from **another kind row** under cover of contextual selection, or using an unlisted or license-unchecked sound.
- Using a `gain_db` outside the guidance table without recording why; conversely, the **mapped** three guidance values (-4 / -6 / -8 at default preset and `i=50`) need no individual rationale.
- Assigning a "similar-sounding" SFX to a kind missing from the table. Leave it unfilled and refer acquisition to setup-audio-library.
- Changing BGM gain or tracks on beats; v0 does not touch BGM.
- Adding an uncontracted transition field to `edit.json` or creating a new highlight overlay component.
- Adopting SFX with `attribution_required: true` without the required credit in the editing report.
