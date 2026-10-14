# critique-cut workflow

## Derive used ranges

Use `bin/used-ranges.mjs`; do not calculate manually.

```sh
node skills/critique-cut/bin/used-ranges.mjs <project-root>/edit.json
```

Output `sources[]` has `src`, resolved `path`, merged observation `ranges[]`, and each cut/item's `uses[]`.
`uses[].source` is source seconds; `uses[].timeline` is timeline seconds.
`media_item_count` / `overlay_item_count` / `telop_item_count` / `filter_item_count` /
`audio_media_item_count` / `caption_track_count` describe timeline composition in findings.

- v0: Treat `cuts[].src` as the media path if present; otherwise resolve to the single `source.path`
  (also read string `source` for compatibility). Empty/absent `cuts` means `whole_source: true`.
  Do not infer the end from edit.json alone; obtain `probe.duration_s` and establish `[0, duration_s)`.
- v1: Resolve `cuts[].src` via `sources[].id` to `sources[].path`. Emit unknown-ID cuts to `warnings[]`
  and exclude them; do not claim observation.
- v2: Read `output.fps` as an integer ≥1. Include only visual-lane `source.kind: "media"` items in media ranges.
  `item.at / fps` is timeline start seconds; `(item.at + item.duration) / fps` is timeline end seconds.
  `at` / `duration` are integer frames; `item.source.in/out` are source seconds. Never mix units.
  HTML/telop/filter and audio-lane media items do not enter `ranges[]`; include them only in type counts
  and maximum end across all items.
- Cut `[in, out)` is a half-open source-seconds interval. Sort each asset by ascending `in`; merge overlaps
  and adjacency satisfying `前の out == 次の in` (existing expression: previous out equals next in).
  Never merge different `src` values even at identical times.
- Normal v0/v1 timeline projection: `(out - in) / speed`, default `speed` 1.
  Maintain a cursor per `track`; explicit `at` places at that timeline second, otherwise append at the preceding
  same-track end. Default `track`: 0.
- v0/v1 `freeze.duration_sec` extends only timeline cut duration, not source ranges.
  `freeze.at_sec` is within-cut seconds after speed adjustment; retain source time and timeline hold range in `uses[].freeze`.
  For v2, item-level `duration` frames are canonical; do not recalculate from source `speed` / `freeze`.
- `timeline_duration_s` is the maximum cut end across tracks for v0/v1, or the maximum end across all items,
  including nonmedia, for v2. Read `overlays` / `layers` / `audio` for finished-visual/edit-intent findings,
  but never mix them into media `ranges[]`.

If `warnings[]` is nonempty, copy it unchanged into critique.md evidence. Do not guess unresolved cuts' sources/content.

## Prior-observation checks

The ledger for asset `path` is `.akari/sidecars/<source-relative-path>.analysis/analysis.json`.
Check existence before CLI execution; never delete/reorder `observations[]`. Missing keys mean unobserved, not absent contents.

Reuse observations meeting these conditions:

| Observation | Reuse condition |
|---|---|
| probe | `probe` exists and `observations[]` contains `kind: "probe"`. Read duration/audio/hash from `probe`. |
| waveform | `tracks.waveform.path` and `kind: "waveform"` exist, current arguments match `observation.args`, and listed outputs exist. |
| transcribe | `kind: "transcribe"` `range` (no range means whole asset) covers current merged `[in,out)` alone or as a union of observations, and corresponding `transcript[]` exists. |

Because `waveform` has no CLI `--in/--out`, intersect existing whole-asset results with used ranges.
Do not rerun per range. If not already observed, run 1 time per asset:

```sh
akari media probe <src-id-or-path>
akari media waveform <src-id-or-path>
```

Only when waveform results give `speech_likely: true`, transcribe individual merged ranges not covered by prior observations.
Never omit `--in` / `--out` and transcribe the whole asset.

```sh
akari media transcribe <src-id-or-path> --in <source-in> --out <source-out>
```

If the local backend is absent/fails, do not guess speech contents; retain failure reasons and mark the section unobserved.
Use existing cloud approval conventions only if the human explicitly specifies the connection and its use.

## Capture time selection

Do not Read all of `edit.json` / `captions.json`; grep by ID and read only matching lines ([Reading edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)).
This workflow does not write them. Other writing stages use relevant-line Edit or edit-store's script API.

Capture times are **timeline seconds**, never source seconds. Fix the output directory beneath this critique report.
**Current `akari capture` supports only edit.json v2**; do not invoke it for v0/v1.
Instead recommend this to the human, but do not execute it because this skill treats edit.json as read-only:

```sh
akari migrate <project-root>
```

Only after the human migrates and saves v2, take the union of `--auto`, representative opening-3-second times,
and explicitly requested times.

```sh
akari capture -p <project-root> --auto -t 0 1 2.999 <requested-timeline-times...> \
  --per-sheet 12 --out .akari/reports/critique/<stamp>/capture
```

For short timelines, capture clamps to the final frame and deduplicates identical frames. Even if multiple sheets
are produced, normally view only 1. Prioritize a sheet containing requested times, then the sheet with most
0–3-second samples; ties go to the first stdout entry. Unselected sheets are unobserved.
Retain `capture.json` and the selected sheet path in critique.md evidence.

If v0/v1 is not migrated or v2 capture fails, view not even 1 image: `images_read: 0`, mark ② Visible picture unobserved,
and record why capture was unavailable. Do not substitute source `grab` images for finished visuals;
do not discuss overlaps, caption positions, clipping, or black frames.

## critique.md template

```md
# Critique

- edit: `<project>/edit.json`
- scope: 使用区間のみ
- images_read: `0 | 1`

## ① 事実

### 事実
- 尺 / カット数 / 使用素材:
- 喋り:
- 無音（timeline 秒 / (src, source 秒)）:

### 読み
- 事実から直接導ける補足。無ければ「なし」。

## ② 見えている絵

### 事実
- 読んだシート 1 枚で確認した重なり / 字幕位置 / 見切れ / 黒味。capture 不可なら「未観察」:

### 読み
- 見え方の評価。シート外は「未観察」。

## ③ テンポと間

### 事実
- cut 長分布 / speed / freeze / 無音:

### 読み
- テンポと間の評価:

## ④ 字幕の要否と方針

### 事実
- 使用区間の発話と、シート上の字幕:

### 読み
- 要否 / 密度 / 方針。根拠が無ければ「未観察」。

## ⑤ フックの位置

### 事実
- timeline 0〜3s にある音・絵・文字:

### 読み
- フックとしての評価:

## ⑥ 次の一手（3 つまで）

1. `[edit-plan 行き | address-review 行き | 追加観察]` 提案と理由

## 証跡

- contact_sheet: `<path | 未観察>`
- capture_manifest: `<path>/capture.json | 未生成（理由）>`
- observed_ranges:
  - `(src, [source-in, source-out))` — `reused | added | unobserved`
- ledgers:
  - `<analysis.json path>` — 再利用した observation / 追記された observation
- used_ranges_warnings: `[]`
- unobserved: 未読シート、失敗した観察、根拠が無い章
```
