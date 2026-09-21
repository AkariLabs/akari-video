**English** | [日本語](./README.ja.md)

# Preview nudge, cycle and hover L1

Run against a built Electron shell, with Node providing `fetch` and `WebSocket`:

```sh
AKARI_CDP_PORT=9757 bash apps/shell/extensions/akari-preview/evidence/preview-nudge-cycle-hover-v1/scripts/run-l1.sh
```

The launcher follows `preview-drill-in-followups-v1/scripts`: it rejects an
occupied port, uses a disposable workspace/profile, waits for Theia readiness,
and cleans up only its own process and temporary directories. `ELECTRON_BIN`
overrides the executable; `AKARI_EVIDENCE_DIR` overrides the evidence output.
There is no build, dependency installation or git commit in this runner.
Startup failure also writes a fresh failing `run-log.json`.

The fixture copies `project-default` and `object-tree-html-bag`, separates the
children of g1 inside outer, adds a lazy bag, and adds two coincident groups.
Only the copied project changes. The six cases drive native CDP input:

1. Select plain; Right ×3 and Shift+Down ×1. Observe immediate live interaction,
   no write before idle, exactly one preview write, and saved x +3 / y +10.
   Main-window capture probes require zero Arrow keydown/keyup events during nudges in steps 1–2 and record `isTrusted`.
   After step 1, an unselected preview Arrow checks forwarding; zero control events are logged as unconfirmed, leaving only the zero-event assertion.
2. Repeat for outer and the lazy bag, each with one transform write.
3. Three single clicks at one point select front, back, front.
4. A double click enters the front group and selects its child.
5. Hover outside the group scope matches its visible children's union; selected
   targets have no hover frame; inside the scope a sibling gets its own frame.
6. Playback pauses on pointerdown and stays paused after selection; a blank
   pointerdown pauses too, then playback resumes when no item is selected.

Each case first returns the timeline to root if necessary, closes/reopens the
preview, and seeks to 1.5s. A real plain click followed by Escape clears the
selection restored from the timeline; the preparations are recorded per case.
`run-log.json` and
step/failure screenshots are written under the evidence directory; exit 0 means
all six cases passed. Instrumentation observes the existing overlayWrite call
and delegates unchanged to it. Tests never execute extracted production source.
To attach to an isolated running app, pass `<port> <workspace> <evidence-output>`
to `run-l1.mjs`.

Run P1 (`preview-drill-in-v1`), P0 (`preview-part-text-edit-v1`), modifiers
(`preview-modifier-keys-v1`), and followups (`preview-drill-in-followups-v1`)
with their existing fixture/runner scripts. Pass a new output directory under
this evidence directory to their `run-l1.mjs` so existing evidence is untouched.

Static checks: `node --check` for both mjs files and `bash -n` for the launcher.
Browser tests: `node --test packages/overlay-runtime/test-harness/nudge-cycle-hover-browser.test.mjs`.
