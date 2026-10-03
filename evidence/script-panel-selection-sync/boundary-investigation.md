# Script panel selection ownership

The script panel is `AkariDaihonWidget` in `apps/shell/extensions/akari-transcript/src/browser/daihon/`. The revised task contract includes this directory. The original dispatch did not, which caused its earlier BLOCKED result.

## Selection flow before this change

- Script rows used the existing `DaihonSelection`. `setSelection()` updated row classes and the dock, emitted `akari.daihon.selectionChanged`, and called `akari.timeline.selectCaptions`.
- The timeline's `AkariAnnotationsWidget` held the canonical caption selection in `TimelineSelectionModel`. Timeline changes emitted `akari.timeline.captionSelectionChanged`.
- Preview selection entered the timeline through `akari-annotations-contribution`. The script panel received preview and timeline events only for placed text, so source script rows and their inspector did not follow external selection.
- `focusTarget()` always called `scrollIntoView({ block: 'center' })`, including when a row was visible or the inspector obscured it.

## Implementation boundary

The script widget now mirrors the canonical timeline caption event into its existing row selection. The timeline publishes that event for preview and script initiated selections too. Row reveal uses the visible height above the inspector and only scrolls when the selected row is outside it.
