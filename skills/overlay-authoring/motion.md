# Motion graphics design

## Principles

Make display state a pure function of `localTime = max(0, timelineTime - start)` and exposed variables. Seeking to the same localTime must return the same image, regardless of playback path.

- Use CSS animation or WAAPI as the primary path. The runtime pauses descendant animations and sets `currentTime = localTime * 1000`.
- Do not use transitions for primary timeline motion; they depend on the instant state changed.
- Do not tie side effects to animation-event count or order. Seeking can skip an event interval.
- Establish particle or repeated DOM elements in advance; derive values from index and a fixed seed. Never regenerate them with unseeded randomness during playback.
- Separate outer-container transforms for AKARI geometry from child transforms for fragment motion.

Do not put `data-start` / `data-duration` on the fragment root. `edit.json` is the SSOT for timeline start and duration. Write internal `animation-delay` and other times in local seconds from clip start 0, never absolute timeline seconds.

## Easing vocabulary

Do not hardcode numeric `cubic-bezier()` functions in fragments. Call the runtime vocabulary **by name** (`packages/overlay-runtime/src/motion-vocab.css`; the host loads it and rasterize.mjs embeds the same content in export sheets).

| Variable | Feel | Use |
|---|---|---|
| `--ease-smooth` | **Default**; quick arrival and long deceleration | First choice for entrances, moves, size changes; unspecified `var(--anim-easing)` resolves here |
| `--ease-natural` | Moderate start with a long deceleration tail | List advances and connected moves |
| `--ease-slowdown` | Maximum initial speed → crawls to rest | Motion settling from speed; strong ease-out |
| `--ease-accelerate` | Deep hold → accelerates away | Exit **assuming an immediate following cut** |
| `--ease-overshoot` | Spring overshooting target substantially (about +90%) | Emphatic leap / pop-in |
| `--ease-overshoot-mid` / `--ease-overshoot-soft` | Milder versions of the same spring (about +66% / +32%) | Safer for somewhat larger displacement |
| `--ease-impulse` | Rushes in and overshoots slightly | Fast slide-in |
| `--ease-linear` | Constant speed | Progress or continuous rotation where speed change has no meaning |
| `--ease-snap-out` / `--ease-hard-out` / `--ease-deep-inout` / `--ease-snappy` | Sharper supporting vocabulary | Crisp telop motion (`telop.md`) |

Target-specific duration variables also guide `--anim-duration`:

| Variable | Value | Target |
|---|---|---|
| `--anim-duration-telop` | 500ms | Telop (per character / Japanese phrase unit) |
| `--anim-duration-shape` | 800ms | Shapes, bands, cards |
| `--anim-duration-group` | 1000ms | Moving a wrapper `<div>` |

**Overshoot / impulse are only for small movements and scale pops.** Overshoot is **proportional** to travel. On a screen-width entrance (hundreds of px of translate), it can shoot hundreds of px past the target and offscreen. Use `--ease-smooth` / `--ease-natural` for long entrances, `--ease-accelerate` for exits, and the overshoot family only for small pop emphasis (scale 0.7→1, a move of tens of px). If a larger move truly needs it, switch to `-mid` / `-soft`.

Prefer this vocabulary over CSS standard keywords such as `ease-out`. Use standard `steps()` only for discrete changes (counter digits, LEDs, stop-motion style). Add a new `cubic-bezier()` only if the vocabulary cannot express the intent; expose it as a CSS variable and record why. See [W3C CSS Easing Functions Level 2](https://www.w3.org/TR/css-easing-2/) for standard keyword definitions.

## Compositor constraints

- In general, change only `transform` and `opacity` every frame.
- Do not animate `top`, `left`, `width`, `height`, margin, padding, grid tracks, or DOM insertion/removal.
- Do not use `filter: blur()` or `backdrop-filter` over 4K video. Preprocess an image if blur is essential.
- Minimize static backgrounds, borders, and shadows. If heavy paint is suspected, measure at actual output resolution; do not invent unsupported performance thresholds.
- Do not leave `will-change` permanently on every element. Limit its targets and active period.
- GPU-export eligibility (`--engine gpu` / `auto`) is a static decision on the HTML string (`packages/gpu-export/src/eligibility.mjs`; canonical `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-28-gpu-export-v0.md` §§2/9). Depth transforms in `@keyframes`, WAAPI `.animate()`, item `keyframes`, or element inline styles (`perspective()` / `rotateX` / `rotateY` / `rotate3d` / `matrix3d` / nonzero-Z `translateZ` or `translate3d` / `transform-style: preserve-3d`) become `degraded`, and `auto` chooses OSR. `translate3d(x, y, 0)` / `translateZ(0)` pass as 2D equivalents. Static 3D only in ordinary CSS rules retains its previous GPU classification. For GPU-targeted motion, use `translate(x, y)` / `scale(x, y)`. Same-document `url(#id)` references and data URIs are not external resources.
- To show an entrance from the first frame, start the animation one frame earlier (negative delay). At 30 fps use `animation-delay: -33.333ms`. Exactly at start time, both preview and export show the CSS 0% state.

## Determinism check

Fail a fragment that includes:

- `Date.now()` / wall-clock differences
- Accumulation from `performance.now()`
- State advanced by `setTimeout` / `setInterval`
- State that keeps adding rAF deltas
- Unseeded `Math.random()`
- Path-dependent accumulation such as `AnimationMixer.update(delta)`

Use rAF only to redraw a state already determined by an external timeline. Current fragments have no general JS seek hook, so custom JS drawing **needs verification**. See [W3C Web Animations](https://www.w3.org/TR/web-animations-1/) for WAAPI time control.

## Static fallback

The static Chrome fallback in `scripts/render-overlays.mjs` disables CSS / WAAPI animation. Ensure the meaning remains clear in a representative still; do not put all content only in an intermediate entrance state. Check the renderer method selected during export.

## Common mistakes

- Assuming recorded time advances after starting a CSS transition.
- Adding `requestAnimationFrame` frame differences to compute position.
- Proliferating meaningless custom easing just to suggest bounce.
- Making outer geometry and inner motion compete on one element.
- Using `filter: blur()` for entrances or exits.
- Hiding the text and conclusion in static fallback.
- Using generic `@keyframes fade-in` and colliding with another fragment.

### Fixed-width overflow without `box-sizing` (measured 2026-08-07)

A fragment that sets fixed `inline-size` (or `width`) **and** `padding` / `padding-inline` on a `position: absolute` element without specifying `box-sizing` gets default `content-box`. Padding adds **outside** the specified width, so rendered width differs from the number.

- Example: `inline-size: 892px; padding-inline: 34px;` rendered at 892 + 34×2 = 960px and overshot the visible boundary by about 90px.
- **Easy to miss in visual preview**: The CSS numbers look plausible; only actual rendering or direct DevTools box-model inspection reveals it.
- Fix: Apply `.foo, .foo *, .foo *::before, .foo *::after { box-sizing: border-box; }` beneath the fragment root. Intentional `content-box` is rarely needed, so put this near the start of the fragment template.

### Implicit 0% override when chaining animations on the same property (measured 2026-08-07)

This occurs when two or more animations on the same element touch the same property (`transform`, `opacity`, etc.), as in `animation: A .3s both, B .3s <delay> both`, and **later B omits an explicit `0%` / `from`**. CSS composes the missing boundary from the static base (underlying value with no animation), **not the current value of A**. B's `both` backwards fill has **priority over A throughout its `delay`**, masking A completely.

This generalizes the two-stage trap called "Fill-mode trap when putting IN/OUT in one `animation` (measured 2026-08-04)" in `telop.md` to **3 or more stages on the same property** and cases where seemingly separate effects share a property.

- Example 1: A cursor does "fade in → move → tap" in 3 stages, but tap defines only `50%` / `100%`, not `0%`. Until tap's delay ends, the cursor freezes at its pre-move position and disappears: move is actually overridden throughout.
- Example 2: Blinking caret `@keyframes blink { 50% { opacity: 0; } }`: with only one stop, 0% / 100% come from base `opacity: 0`, so the caret **stays invisible forever** (it can look as though it is blinking, but is actually hidden at all times).
- **Easy to miss in visual preview**: Stillness or absence may look like the final state. Compare multiple actual rendered frames.
- Fix: (1) Always define both endpoints of a one-off loop such as blink (`0%, 100% { opacity: 1; } 50% { opacity: 0; }`), never omit one. (2) For staged effects on one property, explicitly copy the preceding stage's landing value into the next stage's `0%` / `from`; never rely on implicit composition.

### Export runtime respects authored `animation-fill-mode` (measured 2026-08-16)

During export, render-cut converts CSS animations into paused WAAPI clones and preserves the authored `fill` (`none` / `forwards` / `backwards` / `both`). Preview and export give fill-mode the same meaning.

Do not give OUT a backward fill.

- For IN followed by delayed OUT on one element, use `animation: intro .3s both, outro .3s 1s forwards`: no backward fill on OUT, so its `0%` does not override IN during delay; IN → hold → OUT runs in order.
- Declare `backwards` / `both` only when `0%` must be visible before delay. To hide transient FX before activation, choose `forwards` / `none`, or make `0%` itself invisible if backward fill is intentional.

### Hidden base on an entering-and-holding element makes it disappear in export (measured 2026-08-14)

edit-lint: `overlays.base-hidden-state`

Before WAAPI cloning, the export sheet has a setup period in which the virtual clock free-runs. A short zero-delay animation can be considered finished in that period and **miss cloning**. The element then returns to base CSS. If base is hidden with `opacity: 0` or `transform: scaleX(0)`, it **disappears completely after briefly appearing, or from the start**.

- Example 1: A heading with a zero-delay, 0.51s impact has base `opacity: 0`: visible near t≈0.3s, gone after t≈0.6s.
- Example 2: A timer bar has base `transform: scaleX(0)` and never extends; this also affects transform, not only opacity.
- Fix: **Base (the style without animation) must be the fragment's final still state.** Put hidden state only at keyframe `0%` / `from`; backwards fill handles the delay. Only transient FX whose final state is also invisible may use base opacity 0.

### Implicit delay:0 in `animation` shorthand beats an ungated `animation-delay` by specificity (measured 2026-08-14)

`animation` shorthand **implicitly resets** omitted subproperties, including `animation-delay`, to their initial values. A gated rule `[data-akari-active] .x { animation: ... }` (specificity 0,2,0) beats an ungated modifier `.x--2 { animation-delay: 2s }` (0,1,0), dropping every per-element delay and **starting all elements together at delay 0**.

Preview, OSR, and GPU all add `data-akari-active` to the outer container during an active interval, so `[data-akari-active] .x` is a common activation gate. They remove it outside the interval; fragments must never fix the attribute on themselves.

- Example: Three heading rows intended to enter at b0/b4/b8 appeared together in export. Character-by-character fall/rotation staggering was also lost. It is easy to miss because it merely looks "fast".
- Fix: **Always put `animation-delay` in the same gated rule as the shorthand.** Use inline `style="--d: 2.043s"` per element with gated `animation-delay: var(--d)`. Modifier-class delay overrides are forbidden.

### Declare every property at every step of multistage keyframes (densification; measured 2026-08-14)

edit-lint: `overlays.keyframes-sparse`

Sparse keyframes (for example, `transform` at all six steps but `opacity` only at 0%/10%/55%) can make WAAPI cloning **silently fail under some conditions**. The converter swallows the failure with `catch {}`, while the original already has `animation-name: none`, so the **entire animation vanishes**. If base matches the final state, the image still looks correct but motion is gone, making the failure very difficult to detect.

- Measured: A fragment with hidden base became completely invisible; densifying fixed it in 6 minimal A/B reproductions. Another sparse fragment worked normally and rendered pixel-identically before and after densifying. **The trigger condition is unknown.**
- Fix: Densification is measured harmless even on working cases, so **declare every property at every step of multistage keyframes** (including `opacity: 1` at every rebound step of an impact). Mechanical audit: for each `@keyframes`, compare the union of declared properties to the first and final steps.

### Keyframe `transform` entirely replaces base centering translate (measured 2026-08-14)

If base centers an element with `transform: translate(-50%, -50%)`, applying keyframes containing only `scale()` removes the translate during animation and **makes the element jump**; CSS animation replaces the transform property rather than merging it.

- Example: During a central chip's pop-in, a gap appeared to its connecting line as the chip shifted down-right while scaling.
- Fix: Include the base component at every keyframe step (`translate(-50%,-50%) scale(0.2)` → `translate(-50%,-50%) scale(1)`). Safest is to center with a parent wrapper (grid `place-items: center`) and leave base transform empty on the animated element.

### An element with `duration` = one beat is at 0% / 100% on exact beat frames (measured 2026-09-04)

An element aligned exactly to beat or cut boundaries (`duration` = exactly one beat) **always hits a boundary value on the exact beat frame** (`0%` / `100%` = offscreen or `opacity: 0`). Inspecting only exact beat and cut-boundary frames makes correctly moving elements look absent everywhere. **Unlike the other items in this section, this is a sampling trap in review, not a fragment defect.**

- Example: During actual production inspection, **two reviewers nearly concluded "the animation is dead"** for beat-aligned entrances/exits; the motion was correct.
- Fix: Never judge from boundary times alone. `akari capture --auto` derives representative times deterministically including the **midpoint** of each overlay / caption interval. Inspect midpoint frames from `capture --auto` (first check that `render.json` `contact_sheet.timestamps_seconds` includes the midpoint). For intervals truly showing nothing, use render-cut's blank-frame scan rather than vision (`verify.blank-frames`: at least 0.3 consecutive seconds; `warning` with active overlay / cut, `info` with zero active items).
