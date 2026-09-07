# Shared video tracks

`timeline.tracks[]` accepts `kind: "video"` with a required non-negative `ref`. One video row owns both `cuts[]` and `layers[]` whose `track` equals that reference. Existing `cuts`, `layers`, `overlays`, `captions`, and `audio` declarations remain supported. Track declaration order remains bottom to top.

Moving a clip across legacy cut/layer rows normalizes visual media rows to distinct video references while preserving row IDs and labels. Native items remain in their original arrays: source references, trim, speed, visual effects, audio semantics, and unknown item properties are retained. Implicit cut start times are resolved before remapping references. Empty source rows remain available as destinations. The guarded write is atomic and a full before/after snapshot provides undo/redo.

Mixed cut/layer intervals share a header and use display subrows when they overlap. A move that would overlap another native cut on the same row is still rejected. Locked rows reject movement; audio and HTML overlay rows remain separate media domains. A video imported from the material bin into a shared video row becomes a cut, retaining its source audio; still images use layers.

Preview and export expand each video row into its native cut and layer streams in the declared order. The preview places the main video and layer videos in one scaled output-coordinate stacking context, so their z-indices can actually cross; cut transforms are applied in output coordinates before the shared display scale. Within a mixed row, layers composite above cuts. Active shared rows select the gap-aware export path, including multi-source video and delayed source audio. This prevents a moved multi-source clip from being concatenated at the wrong time. Empty shared rows alone do not alter export routing.

Current limitations: cross-domain conversion of rows containing freeze holds or `transition_out` is rejected without writing. Their nonlinear timing is not supported by the shared row export path. Existing legacy workflows remain available. Caption `display_policy` retains its existing guard against declared cut winner-order overrides.

Header reordering listens on the document, defers timeline reconstruction during the gesture, and writes stable row IDs. Escape and pointer cancellation never commit; pending media redraws resume after cancellation. Only the audio group remains pinned at the bottom.
