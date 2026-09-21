# Concurrent caption preview and display-policy evidence

## Fixture and reproduction

`edit.json` and `captions.json` declare three source cues (0–2, 2–4, 4–6 seconds)
and one output cue (0–6 seconds, top position). Observe at **3 seconds**.
The media is deterministic and recreated by `scripts/prepare-fixture.mjs`.
Large media and runtime logs stay in `<tmp>/cof-l1`.

The first BEFORE capture was made **before production code was changed**. Its top
cue used the id `placed` (`before/fixture-captions.json`). That id renders, but does
not satisfy the caption write schema. It was corrected to `c-0004`, without
changing text, timing, source or style. The baseline preview/display implementations
were then rebuilt from their original sources and all three observations repeated
with the corrected fixture. All AFTER runs use this same corrected fixture.

## BEFORE

- **(a) Preview:** default frame-engine reports active=true, ready=true. Only
  `上に置いた文字` appears; `二行目の字幕` is missing. See `before/` (initial)
  and `before-corrected/` (valid fixture). With frame-engine disabled the result
  is identical: `before-legacy/`.
- **(b) Export without display_policy:** OSR succeeds. The frame at 3 seconds shows
  both captions: `before-export.png` and `before-corrected-export.png`.
- **(c) Export with display_policy:** OSR fails with `OVERLAPPING_DISPLAY_CUES`.
  The corrected fixture reports c-0001 and c-0004 in
  `before-corrected-policy-error.txt` (initial: `before-policy-error.txt`).

## AFTER

- `after/`: default frame-engine, no display policy, both rows visible. Dragging
  c-0004 changes only that row; all three source rows remain unchanged as
  parsed JSON. Double-clicking c-0002 edits its text and preserves c-0004.
- `after-policy/`: the same default-engine interactions also succeed with
  single_line_sequential display_policy. Screenshots and `results.json` include
  the observed position and edited text. `captions-after-interactions.json` is
  the actual saved document.
- `after-legacy/`: frame-engine disabled; both rows, row-specific drag and inline
  edit also succeed. The probe waits for startup and recalculates click coordinates
  after a resize, since initial window layout can settle asynchronously.
- `after-web.png` / `web-results.json`: the actual Web UI shows both rows after the
  shell interaction writes, with zero page errors.
- `after-policy-export.png`: successful OSR export with display_policy, extracted
  at 3 seconds. `after-export-verification.json` records 120 frames, 1280×720,
  30 fps, 4 seconds, H.264, and all verification checks passing.
- `same-group-lint.json`: changing the output row to the same source domain still
  produces the existing `captions.overlap` **error**. Unit tests also require
  `OVERLAPPING_DISPLAY_CUES` for same-group overlap and permit touching endpoints.

The host cannot decode this H.264 fixture with software-only OSR. Hardware-enabled
npm Electron (tier 2) succeeds; real-render regression tests use `AKARI_OSR_SOFT=0`.
The initial software failure is independent of the overlap failure.

## Commands

Run from the repository root. Use a fresh label for each isolated shell profile.
The launcher refuses an occupied CDP port; stop only the PID it prints before
starting another shell. Runtime home, config, profile and project are isolated.

```sh
node apps/shell/extensions/akari-preview/evidence/captions-overlap-foundation/scripts/prepare-fixture.mjs /tmp/cof-l1/project
node apps/shell/extensions/akari-preview/evidence/captions-overlap-foundation/scripts/launch.mjs after
AKARI_CDP_TIMEOUT_MS=60000 node apps/shell/extensions/akari-preview/evidence/captions-overlap-foundation/scripts/observe.mjs 9437 /tmp/cof-l1/project <evidence-output> after
node apps/shell/extensions/akari-preview/evidence/captions-overlap-foundation/scripts/export.mjs /tmp/cof-l1/project /tmp/cof-l1/export.mp4 policy
ffmpeg -ss 3 -i /tmp/cof-l1/export.mp4 -frames:v 1 <evidence-output>/export.png
```

A label containing `legacy` sets `AKARI_FRAME_ENGINE=0`. Without `policy`, the
export script removes the display policy. Recreate the fixture between independent
observations to reset drag/edit writes. Exporting four seconds is sufficient to
observe the second source cue and the output cue together.

## Validation notes

The existing ES2021 build error was removed by replacing the one `ancestors.at(-1)`
with indexed access. All generated files are outputs of the repository's build
or bundle commands. The webview kernel remains an IIFE.

New regression tests use no media executables. The focused group (91 tests) also
passes with PATH pointing at a nonexistent directory. Existing single-caption
animation, hit-region, selection and visual-parity tests are retained.

The Web UI's existing `preview.test.mjs` has the same six failures with the baseline
and changed app: overlay HTML PUT returns 422; background selection/selection frame/
resize handles, background deletion and role-less overlay dragging fail. These
are outside the caption task and were left unchanged. Baseline comparison and
final suite counts are recorded in `validation.json`.


| Suite | Tests | Pass | Fail | Skip | Seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| edit_store | 869 | 869 | 0 | 0 | 19.822 |
| preview_server | 375 | 373 | 1 | 1 | 202.158 |
| akari_preview | 1301 | 1301 | 0 | 0 | 113.463 |
| render_cut_hardware | 611 | 607 | 4 | 0 | 369.640 |
| new_tests_without_tools | 91 | 91 | 0 | 0 | 0.734 |

The four render-cut failures also reproduce after rebuilding the original caption
implementations and original renderer bundles: SFX input at its material end exits
1, two stored 3D-sheet hashes disagree, and the bundled platform ffmpeg executable
is missing. No render-cut implementation or existing failure expectation was changed.
The initial parallel Web UI run also hit timing limits; the final sequential run
has only the baseline browser suite failure above.

Final drift check: **all bundle drift checks passed**. `git diff --check` is clean,
the webview kernel is an IIFE, and all five Governance patterns have zero matches
(including untracked evidence). [Changed files](changed-files.txt) are within the
owned boundary. Own Electron processes, temporary project media and profiles were
cleaned up after recording the evidence.
