# issue #82 — resolving an annotation scrolls the list back to the top (L1 evidence)

`run-l1.mjs` launches the built shell (Electron, CDP 9484) on a scratch project. The profile, `THEIA_CONFIG_DIR`, and `AKARI_HOME`
all point into a temp dir whose name contains the slug. The project has 15 annotations, all 対応済み (addressed).

The script measures each scroll container over CDP before and after the operation:

- `scrollTop`
- the first visible item id (`data-annotation-row` / `data-board-card`)
- that item's offset from the top of the container

`scroll` events are logged over time. Screenshots are cropped to the panel/board area.

| scenario | operation |
|---|---|
| p1 | 注釈 panel, filter すべて: scroll down so the 12th item (a-0012) is at the top of the view, then press 確認済みにする |
| p2 | 注釈 panel, filter 対応済み: put the 12th listed item (a-0013) at the top of the view and resolve it. The item leaves the list, so the next item must take its place |
| p2b | same as p2 in the middle of the list (a-0005), where the list end does not clamp the scroll |
| p3 | 注釈 panel, filter すべて, scrolled to the bottom: add 1 annotation to review.json from outside (sourceT smallest, so it is inserted at the top) |
| b1 | レビューボード, 対応済み column: scroll down to the column's 12th card and press 完了にする |
| b2 | レビューボード, 対応済み column, scrolled to the bottom: add 1 annotation from outside (inserted at the top) |

## Measured

The BEFORE build is the base commit and the AFTER build is this change. BEFORE was captured with an earlier version of `run-l1.mjs`
that had no p2b and required the same first-visible id even when the list end clamps the scroll. The scenario steps are otherwise identical.

| scenario | BEFORE scrollTop → | BEFORE first visible | AFTER scrollTop → | AFTER first visible (offset Δ) |
|---|---|---|---|---|
| p1 | 1467 → 4 | a-0012 → a-0001 | 1467 → 1467 | a-0012 → a-0012 (0 px) |
| p2 | 1467 → 4 | a-0013 → a-0001 | 1467 → 1416 (end clamp: max 1416) | next item a-0014 at +51 px (row height 133 px) |
| p2b | — | — | 536 → 536 | a-0005 resolved → a-0006 at the same place (0 px) |
| p3 | 1604.5 → 1737.5 | a-0013 → a-0013 (native scroll anchoring) | 1565.5 → 1698 | a-0013 → a-0013 (0.5 px) |
| b1 | 3069.5 → 6 | a-0011 → a-0016 | 3069.5 → 3069.5 | a-0014 resolved → a-0015 at the same place (0 px) |
| b2 | 3325 → 3325 | a-0014 → a-0010 (view pushed down by one card) | 3129.5 → 3408 | a-0015 → a-0015 (0 px) |

- The saved resolve is unchanged: the review.json record of a-0012 after p1 is identical between BEFORE and AFTER (all keys and values) (`status: "resolved"`, same keys).
- Full numbers, row orders and scroll logs are in `run-log-before.json` and `run-log-after.json`.

## Cause

Both lists are rebuilt from scratch on every review model change: `listContainer.replaceChildren()` in the panel, and each column's
`list.replaceChildren()` in the board. After a resolve, the rebuilt list comes back scrolled to the top (scrollTop ≈ 0).
On the board, a new annotation inserted above the view pushed the visible cards down.

## Fix

Before each rebuild, the widget remembers the first visible item id, its offset, and the previous order. After the rebuild it sets
`scrollTop` so that the same item is at the same offset. If that item left the list, it uses the next item in the previous order
(or the previous item if there is no next one). This applies to the panel and to each board column independently.

A list sitting at the very top stays at the top. The helpers `captureReviewScrollAnchor` / `restoreReviewScrollTop` are pure
functions, tested in `test/review-list-scroll-anchor.test.mjs`.

Usage: `AKARI_CDP_PORT=9484 AKARI_L1_LABEL=after node run-l1.mjs` (requires a built `apps/shell`).
