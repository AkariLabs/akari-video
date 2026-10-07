# Material ranges v0

The project stores non-destructive source selections in `.akari/material-ranges.json`:

```json
{ "version": 1, "ranges": { "assets/example.mp4": { "in": 2.5, "out": 8 } } }
```

Keys are project-relative media paths. `in` and `out` are seconds in the original media; `out` is greater than `in`. Removing a selection deletes its key. A missing or malformed file means no selections. Updates preserve unrelated top-level keys and other material entries and replace the file by writing a temporary file and renaming it.

The selected list strip exposes two handles. Its minimum width is the larger of one second and 24 pixels expressed in source seconds, capped by the media duration. Dragging one handle keeps the other fixed. Double-clicking the strip or pressing × clears the selection. Changes are saved after 150 ms.

Material drag payloads and `akari.timeline.addMaterialAtPlayhead` requests may carry `in` and `out`. Drag placement uses the payload; playhead placement reads the saved range. Video and audio placement cap `out` at the media duration and use the full source when no valid range is present. `akari.materials.range.get` and `.set` expose the stored range to other views; changes emit `akari.materials.range.changed` with `{ relativePath, range }` on `window`. Range setters may include `source`; the event preserves it so a view can ignore echoes of its own changes.
