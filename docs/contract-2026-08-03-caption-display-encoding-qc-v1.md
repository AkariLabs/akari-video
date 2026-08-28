# caption display / encoding / audio QC v1 contract

- Date: 2026-08-03
- Status: implementation contract
- Compatibility: all new behavior is opt-in; captions without `display_policy`, renders without
  `output.encoding`, and edits without an `audio.master` object retain their legacy paths

## 1. One Node caption-display kernel

`packages/edit-store/src/caption-display.ts` is the only resolver for the opt-in
`display_policy.mode: "single_line_sequential"` contract. It projects source captions through a
linear cut/speed/multi-source timeline, then resolves one or two fragments, timing, source
provenance, merged style variables, and reference-pixel geometry. Render-cut, preview-server, and
the shell backend consume that result. Browser code only selects already-resolved timeline cues; it
must not call `Intl.Segmenter` or implement the split algorithm.

The policy rejects unsupported `at`, `track`, transition, and timeline winner semantics; caption
style/emphasis conflicts; non-NFC or trimmed text; invalid manual fragments; unresolved long text;
overlap; and reference/output aspect mismatch. A resolved production render stores
`.akari/reports/caption-layout/<payload-sha256>.json`, including Node/ICU provenance and the boundary
projection digest, and its immutable render receipt references the file and summary.

Under `display_policy`, an omitted `captions[].style` remains valid. The known word-display styles
`karaoke`, `pop`, `reveal`, and `reveal-word` remain `STYLE_CONFLICT` errors, while any other value is
an `INVALID_CAPTION` error that names the unknown value and the accepted vocabulary. Without
`display_policy`, caption style handling remains on the unchanged legacy path.

`reference-pixel` geometry is scaled only after exact aspect agreement. `webkit-outline` produces
real `-webkit-text-stroke` plus `paint-order:stroke fill` and disables shadow. Single-line consumers
use the resolved plate box, `white-space:nowrap`, zero padding/gap, transparent background, and no
caption animation. Noto Sans JP remains the portable font contract; Hiragino glyph parity is
`UNRESOLVED_FONT_ASSET` and is not implied by numeric geometry parity.

### 1.1 Caption text animation

Outside `display_policy.mode: "single_line_sequential"`, the shared `textStyle` contract accepts an
optional `animation` object. `default_text_style.animation` supplies project-wide defaults, while
`captions[].text_style.animation` overrides only the named slots for that caption. The legacy
`captions[].style` values (`karaoke`, `pop`, and `reveal`) remain a separate word-display axis and
are not text-animation preset ids.

The animation object has three optional, independently merged slots: `in`, `out`, and `loop`; at
least one slot is required when the object is present. Each slot requires an `id` and may carry a
positive `duration_sec`, a non-empty CSS `ease`, and a positive `amp`; `ease` and `amp` may also be
`null` to request renderer defaults. The closed 47-id vocabulary is defined by
`presets/textanim/index.jsonl`. Unknown ids and unknown object keys are errors. `out` reverses the
selected recipe, and `loop` repeats it for the caption lifetime. The single-line sequential policy
continues to disable caption animation as specified above.

## 2. Encoding resolution

`output.encoding` accepts `quality: master|high|standard|light` and
`encoder: auto|videotoolbox|nvenc|qsv|amf|mf|x264`. Resolution is once per render with field precedence
CLI flag > edit field > legacy default. The returned `requested` and `effective` values retain an
`origin`. With neither CLI nor edit opt-in, the legacy plan and command bytes remain unchanged.

`master` means x264, High profile, preset slow, CRF 15. Omitted encoder becomes x264 with origin
`master-required`; explicit `auto`, `videotoolbox`, `nvenc`, `qsv`, `amf`, or `mf` is rejected. The same effective argument array
is used by every video-encoding stage. The audio-only final mix/mux records its reason and uses
`-c:v copy`.

## 3. Audio QC evidence, not conformance

`audio.master.true_peak_dbtp` is optional in `[-9, 0]` and defaults to the existing -1.5 dBTP.
Whenever `audio.master` is an object, the immutable render receipt requires `audio_qc`. It preserves
the real loudnorm filter report separately from a second-process decode measurement of the finished
artifact. Raw FFmpeg strings and normalized `finite number | "-inf"` values are both retained.

Successful measurement remains `INCONCLUSIVE`; it is not a loudness PASS. Full status carries a
warning, and `akari accept` displays configured targets, filter output, and decoded measurement
before checksum confirmation. Parse, field, process, or 1 MiB capture failures become the closed
`MEASUREMENT_ERROR` shape, keep a content-addressed artifact and receipt when structurally possible,
leave render state in `phase:error`, return exit 1, and cannot produce an integrity candidate.

### 3.1 True peak AAC overshoot guard (2026-08-17, task 2026-08-17-render-cut-true-peak-guard)

The `filter_report.normalized.output_tp` loudnorm reports for the PCM stage is not the artifact's
real true peak: the AAC re-encode that follows can measurably overshoot it (a real render measured
`filter_report` at -1.00 dBTP against a decoded artifact at +0.23 dBFS — about +1.2 dB of
codec-introduced overshoot; `planning/notes-2026-08-17-mac-fresh-install-bug-reports.md` #05). Two
additive mitigations apply only when `true_peak_dbtp` is **explicit** in `audio.master` — the -1.5
dBTP default is unchanged and unmargined:

- **Applied margin.** `packages/render-cut/src/plan.mjs` hands loudnorm `configured -
  AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP` (1.5 dB, `packages/render-cut/src/audio-qc.mjs`) instead of
  the raw configured value, so the *decoded* artifact — not just the PCM stage — has a better chance
  of landing under what the caller asked for. The receipt records both under an additive
  `audio_qc.true_peak_margin: { overshoot_margin_dbtp, applied_true_peak_dbtp }` field;
  `audio_qc.configured.true_peak_dbtp` is unchanged and still reports the caller's original value.
  The margin is a fixed mitigation, not a guarantee — real-render testing found synthetic
  high-transient material where even the margined target still decodes above 0 dBFS (this is what
  the next mitigation exists to catch).
- **Overshoot detection.** When `decoded_measurement.normalized.input_tp` exceeds
  `configured.true_peak_dbtp` by more than a 0.1 dB tolerance, `buildAudioQc` appends an additive
  `audio_qc.warnings: ["TRUE_PEAK_EXCEEDED: ..."]` entry — readable from the receipt alone, no
  human needs to eyeball the two numbers. `verdict` deliberately **stays `"INCONCLUSIVE"`**, not a
  new value: `packages/akari-launcher/src/status-core/integrity.mjs` (mirrored at
  `plugin/runtime/status-core/integrity.mjs`) closed-world-validates the successful-measurement
  branch and rejects any verdict string other than `"INCONCLUSIVE"` as a structural integrity
  problem, and `accept-command.mjs` keys its human-review warning off that exact string. A new
  verdict value would have misreported a legitimate receipt as malformed instead of surfacing the
  overshoot, so exceeding true peak is additive evidence on an otherwise-`INCONCLUSIVE` receipt, not
  a verdict of its own.

Both fields are additive to the existing `configured` / `filter_report` / `decoded_measurement`
triple — nothing already reading `audio_qc` needs to change, and their absence (when
`true_peak_dbtp` is left at its default, or when nothing exceeded) is the unchanged legacy shape.

## 4. Recipe boundary and evidence grade

Recipe `caption_style_ref` is descriptive only. It is not registry-backed and never injects caption
policy/style, encoding, or audio fields. The current request wins, freeze contains only explicitly
human-confirmed values, and `render_profile_ref` is not introduced before a versioned registry with
a content digest exists. Preview parity and generated-media checks without new production material
are `partial_run`, never `production_run`.

Executable specifications live in the edit-store, schemas, edit-lint, render-cut, preview-server,
shell preview, and launcher test suites. The external A4 verifier accepts an explicitly supplied
project root and independent manifest; absence of the frozen local fixture is a skip, not a pass.
