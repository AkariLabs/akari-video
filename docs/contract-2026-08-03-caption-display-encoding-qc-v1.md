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

`reference-pixel` geometry is scaled only after exact aspect agreement. `webkit-outline` produces
real `-webkit-text-stroke` plus `paint-order:stroke fill` and disables shadow. Single-line consumers
use the resolved plate box, `white-space:nowrap`, zero padding/gap, transparent background, and no
caption animation. Noto Sans JP remains the portable font contract; Hiragino glyph parity is
`UNRESOLVED_FONT_ASSET` and is not implied by numeric geometry parity.

## 2. Encoding resolution

`output.encoding` accepts `quality: master|high|standard|light` and
`encoder: auto|videotoolbox|x264`. Resolution is once per render with field precedence
CLI flag > edit field > legacy default. The returned `requested` and `effective` values retain an
`origin`. With neither CLI nor edit opt-in, the legacy plan and command bytes remain unchanged.

`master` means x264, High profile, preset slow, CRF 15. Omitted encoder becomes x264 with origin
`master-required`; explicit `auto` or `videotoolbox` is rejected. The same effective argument array
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

## 4. Recipe boundary and evidence grade

Recipe `caption_style_ref` is descriptive only. It is not registry-backed and never injects caption
policy/style, encoding, or audio fields. The current request wins, freeze contains only explicitly
human-confirmed values, and `render_profile_ref` is not introduced before a versioned registry with
a content digest exists. Preview parity and generated-media checks without new production material
are `partial_run`, never `production_run`.

Executable specifications live in the edit-store, schemas, edit-lint, render-cut, preview-server,
shell preview, and launcher test suites. The external A4 verifier accepts an explicitly supplied
project root and independent manifest; absence of the frozen local fixture is a skip, not a pass.
