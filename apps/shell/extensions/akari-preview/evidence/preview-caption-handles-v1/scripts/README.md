**English** | [日本語](./README.ja.md)

# Caption selection handles L1

Run from a checkout whose Electron bundle has already been built by the wrapper. These scripts never build or install dependencies. `before` must use the pre-fix bundle (75c3c736); `after` must use the corrected bundle. Run them sequentially.

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-caption-handles-v1/scripts/run-l1.sh before
# The wrapper builds the corrected application between these commands.
bash apps/shell/extensions/akari-preview/evidence/preview-caption-handles-v1/scripts/run-l1.sh after
```

The launcher checks that the CDP port is free, creates an isolated project and user profile, launches Electron directly, and cleans up only its own PID and temporary directories. It imports CDP, `realClick`, and `screenshot` from the timeline-tracks evidence helper, following preview-modifier-keys-v1. No product Git operations are performed. The initial commit is inside the disposable fixture only.

Prerequisites: the built shell and edit-store libraries, Node with built-in WebSocket support, ffmpeg, Git, and a graphical desktop. `ELECTRON_BIN` overrides the executable (macOS paths are auto-detected); `AKARI_CDP_PORT` defaults to 9767; `AKARI_FFMPEG` overrides ffmpeg. A startup failure replaces the applicable run log with FAIL and exits nonzero.

The fixture copies `templates/project-default` and overlays `packages/render-cut/test/fixtures/caption-item-render`. Its declared caption bag uses a generated PNG background and three cues: c-0001 and c-0002 overlap at 0.25–2 seconds at separate vertical positions; c-0003 occupies 2.5–4.5 seconds. At 2.25 seconds no caption should be present. c-0001/c-0003 use the main source clock and c-0002 uses output time, matching captions-overlap-foundation without violating same-time-group overlap validation. Fixture preparation validates with the existing project write gate before initializing its temporary Git repository. For isolated fixture validation without a commit:

```sh
node apps/shell/extensions/akari-preview/evidence/preview-caption-handles-v1/scripts/prepare-fixture.mjs /tmp/akari-caption-fixture-check --lint-only
```

`before` records the actual click regression: active blue box, no `data-selected`, and zero handles. It then attempts the intermittent missing-caption reproduction for ten minutes: repeated forward/backward seeks, two simultaneous rows, and row counts immediately after real text edits. Each sample retains the expected cue IDs, visible rows and selection state. A detected disappearance is recorded as `reproduced: true`; absence of a reproduction is explicitly recorded and does not claim a rendering fix. `AKARI_CAPTION_PROBE_MS` can shorten this loop for harness debugging; the requested and actual durations are logged, so a shortened run is not ten-minute acceptance evidence.

`after` verifies the same click, the yellow computed outline and five handles, removal/recreation of selected rows, live and persisted corner scale, Shift rotation, body position, host single/multiple selection, primary changes within the group, empty-click/Escape deselection, and editing Escape/overlap regressions. Rotation sends `modifiers=8` on every drag event and requires a nonzero saved multiple of 15°. Host selection uses the existing main-window `akari.daihon.selectionChanged` and `akari.timeline.primarySelected` routes and observes the resulting webview messages. It never substitutes direct mutation of the webview selection state. Gestures and text entry use CDP input.

Seeks use `akari.preview.seekOutput` with `waitForReady: true`, which waits for the current renderer/model, cancels initial playback restoration, pauses playback, and uses the application's normal seek path. The runner first checks clock readiness and sufficient duration, then requires a fresh, paused `playbackTick` observation at the exact expected output time on two consecutive polls. Frame-engine seeks use its `Math.round(time * fps) / fps` rule: 2.25 seconds at 30fps must reach frame 68 (68/30 seconds). The tolerance is 1e-6 seconds, not a widened slider tolerance. A transparent observer preserves the original playback notification; no clock value is assigned. Up to three attempts reattach after iframe replacement and retry the same target. `seeks` records requested times, expected frames, attempts, actual clock observations and slider diagnostics; caption/handle expectations remain unchanged.

Persistence detail: the current `handleCaptionWrite` saves `captions.json` (`text_style.scale`, `rotate`, and `position`), not `edit.json`. The runner records both project files and asserts the actual sidecar values, including unchanged neighboring cues. Moving those writes into `edit.json` would exceed the permitted selection-only patch. This discrepancy with the contract's “saved in edit.json” wording remains visible in the run log rather than being reported as an edit.json write.

CDP command results are reduced inside the main window to a JSON scalar and a type name. Widget objects, cycles, getters and custom serialization never cross `returnByValue`; the literal `seeked` acknowledgement is preserved. `commands` logs invocation timing and these safe summaries. Startup opens the timeline once instead of repeating a timed-out widget command. Context destruction, context clearing and closed connections invalidate the preview attachment; read-only observations rediscover the live context, while mouse/key gestures are never replayed into a replacement document. A per-document observer identity prevents replacement-page ticks from satisfying an earlier seek. Host selection waits for the matching delivered message, and text input waits for the actual focused editor content. The pure safeguards in `runner-support.mjs` have headless coverage in `test/preview-caption-handles-runner.test.mjs`.

Outputs are `../run-log-before.json` and `../run-log.json`; screenshots use separate `before-*` / `after-*` names. After exits 1 if any check fails; unexecuted checks remain `not-run`, never PASS. Before exits 1 if its expected regression is absent or the probe cannot execute. The wrapper runs the existing preview-modifier-keys-v1 and captions-overlap-foundation suites separately; the new runner includes caption Shift/Escape and overlap checks but does not claim to have executed those entire suites.
