**English** | [日本語](./README.ja.md)

# Preview marquee L1

This runner prepares a disposable project based on the preview multi-selection fixture: three root HTML siblings, a group with two children, and a half-size cut copied from the repository's small video fixture. The cut leaves a media-free border inside the stage. It launches Electron with an isolated profile and sends native CDP pointer and keyboard input. Screenshots and `run-log.json` are written to this directory or `AKARI_EVIDENCE_DIR`.

Build the current edit-store, preview-server runtime bundle, and shell before running:

```sh
npm --prefix packages/edit-store run build
npm --prefix packages/preview-server run build
npm --prefix apps/shell run build
bash apps/shell/extensions/akari-preview/evidence/preview-marquee-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` defaults to `9774`, separate from the other preview suites. `ELECTRON_BIN` may override the executable. The launcher rejects an occupied port and removes only its own temporary workspace, profile, and Electron process. The wrapper performs the actual L1 run; the presence of these scripts does not claim a pass.

The nine checks cover two-item marquee selection and timeline rows, ⌘G grouping, plain cut dragging, Shift marquee over media, pan and Shift marquee at 200% zoom, additive Shift marquee, Escape cancellation, selection within a group scope, and stationary blank-click release. Grouping is undone before later checks so they continue on the original fixture. All tested gestures use CDP input; application commands and DOM reads are used for setup and observation.

The runner waits for the overlays to mount before measuring their bounds.

Step 3 waits for the cut to become ready after the undo. If the host drops a drag during the preview redraw, it retries the same gesture up to three times and records each try in `attempts`. In step 5, an Alt drag first pans to the top-left clamp to expose the stage's media-free border. A plain drag from that blank area must pan without starting a marquee, changing the cut, or clearing the overlay selection. A Shift drag starts on the media and must show the marquee without changing the pan. Step 9 records that a stationary click on the pasteboard outside the stage keeps the selection, then checks that a stationary click on a media-free, overlay-free point inside the stage clears it.
