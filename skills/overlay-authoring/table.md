# Table and chart design

## Principles

- Use a semantic `<table>` when precise value lookup and comparison are primary. To show trends, rank, or proportions at a glance, combine DOM labels and values with CSS Grid / Flex.
- Keep data as HTML text; never trap values or labels solely in canvas pixels.
- Set displayed values, order, units, and rounding before authoring. Values shown together must use the same basis and units.
- Do not distinguish series by color alone; also use labels, shapes, and positions. Make axes, legends, and baselines readable before decoration.
- Expose `--accent-*`, `--label-color`, `--value-color`, `--row-gap`, `--bar-scale`, and similar controls as CSS variables.
- Scope selectors and `@keyframes` names under the fragment-specific root.

## HTML/CSS structure

- Use `<caption>`, `<thead>`, `<tbody>`, and `<th scope>` for tables. Do not replace them with div tables just for appearance.
- Give a bar chart DOM elements for label, static numeric value, track, and fill. Normalize each value to **0–1** over its domain; express fill as `transform: scaleX(var(--ratio))` or `scaleY()`.
- Use `font-variant-numeric: tabular-nums` when digits move. Put the final value in static text and reveal it; never count up on wall-clock time.
- Even if arcs or continuous curves are truly needed, retain a readable DOM summary of the values. Do not casually add an external chart library.
- The repository contract has no universal thresholds for row count, type size, or spacing. If content does not fit, split the screen rather than shrink it. Mark specific values **needs verification** for the output profile.

If the whole chart only needs to move as a unit, the track + fill design using `--ratio` scale above is sufficient. If every bar must be directly editable in preview, arrange div columns with flex / grid, give each bar the first class `bar`, each value `value-label`, and each axis label `axis-label`. Set finished length with pixel `height` (or `width` for horizontal bars). Use scale only for an entrance from `0` → `1` (ending at natural size); never animate `width` / `height` every frame. Keep tables as semantic `<table>` elements and give likely editable values or labels in cells classes. SVG bars are not individually selectable, so use divs when direct editing is expected.

```html
<div class="sales-chart" style="display: flex; align-items: flex-end; gap: var(--bar-gap, 16px)">
  <div class="bar-group" style="display: flex; flex-direction: column; align-items: center">
    <span class="value-label">44</span>
    <div class="bar" style="width: var(--bar-width, 48px); height: var(--bar-apr-height, 176px); background: var(--bar-color, #5c8df6)"></div>
    <span class="axis-label">4月</span>
  </div>
  <div class="bar-group" style="display: flex; flex-direction: column; align-items: center">
    <span class="value-label">75</span>
    <div class="bar" style="width: var(--bar-width, 48px); height: var(--bar-may-height, 300px); background: var(--bar-color, #5c8df6)"></div>
    <span class="axis-label">5月</span>
  </div>
</div>
```

## Animation

- Put a bar's `transform-origin` at its baseline and grow it with scale. Never change `width` / `height` every frame.
- Stage rows or cards with translate + opacity. Do not shake layout by inserting or removing DOM nodes.
- Put final sort order in the DOM first, then show movement with child transforms if necessary. Never reorder table rows during playback.
- Use CSS animation / WAAPI and map motion deterministically to local time in the visible interval `start <= t < start + duration`.
- Static Chrome fallback disables animation. Values, units, and conclusion must remain clear in a still frame.

## Common mistakes

- Representing precise comparisons only with a 3D pie chart or decoration.
- Adding a canvas/chart library and assuming scripts run in live preview.
- Animating bar `width`, row `top`, or grid tracks.
- Incrementing a value with `setInterval`.
- Distinguishing meaning only by series color.
- Inventing an arbitrary "maximum row count" for dense information or shrinking text excessively.
- Using a global `table` selector or generic `@keyframes grow`, causing collisions with other fragments.

## Basis

- Timing, single root, CSS variables, and compositor contracts: `CLAUDE.md` and `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-m1-m4.md`
- Static fallback limitation: `scripts/render-overlays.mjs`
