# Material ranges v0

The project stores non-destructive source selections in `.akari/material-ranges.json`:

```json
{ "version": 1, "ranges": { "assets/example.mp4": { "in": 2.5, "out": 8 } } }
```

Keys are project-relative media paths. `in` and `out` are seconds in the original media; `out` is greater than `in`. Handle changes round both values to 0.01 seconds before saving. Removing a selection deletes its key. A missing or malformed file means no selections. Updates preserve unrelated top-level keys and other material entries and replace the file by writing a temporary file and renaming it.

The selected list strip exposes two handles. Its minimum width is the larger of one second and 24 pixels expressed in source seconds, capped by the media duration. Dragging one handle keeps the other fixed. Pressing × clears the selection and announces the change; double-clicking the strip leaves the selection intact. An unselected strip shows an orange line at the saved range. Changes are saved after 150 ms.

Material drag payloads and placement requests may carry `in` and `out`. The range applies when a person places material through panel drag and drop, the panel's Add to Timeline action, a drop on the central output preview, or placement from the material preview. Other callers of `akari.timeline.addMaterialAtPlayhead` and `akari.timeline.addMaterialAtOutputPoint` use the full source unless their request explicitly supplies a valid pair. Video and audio placement cap `out` at the media duration; if `in` reaches or exceeds the media duration, placement uses the full source. `akari.materials.range.get` and `.set` expose the stored range to other views. Changes emit `akari.materials.range.changed` on `window` with `{ relativePath, range, source }` when the setter supplies `source`; views can use it to ignore echoes of their own changes.

Ranged audio is placed as an audio-track item by both playhead placement and output-preview drop, because the legacy `audio.sfx` form cannot store `in` and `out`.
