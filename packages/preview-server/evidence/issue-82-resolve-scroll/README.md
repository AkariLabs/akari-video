# issue #82 — browser preview (preview-server Web UI): not affected

The browser preview has no annotation list and no resolve action, so this issue cannot occur there.

Static check against the base commit:

- `packages/preview-server/public/index.html` has no annotation / review list element. Its UI ids are the stage, the waveform, the transport
  controls, the pen toggle, `review-record-btn`, and `review-timer`.
- `packages/preview-server/public/app.js` has only two `annotation` hits. Both are pen-annotation canvas comments (`// Pen annotation`).
  There is no `review.json` read or write, no resolve / 解決 / 確認済み action, and no annotation row rendering.
- `packages/preview-server/src/` has no review.json route.

The only annotation panels in the product are in the desktop shell: the right-dock 注釈 panel and the レビューボード.
The measurements and the fix are in `apps/shell/extensions/akari-annotations/evidence/issue-82-resolve-scroll/`.
