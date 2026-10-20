# Glass refraction authoring

## Route selection (decide this first)

Use the bundled `glass-runtime.js` for glass refraction; fragments contain only declarations and CSS. The host loads `glass-runtime.js` before `overlay-runtime.js`. Do not bring arbitrary scripts, CDNs, html2canvas, or custom rAF into a fragment.

## Current implementation gate

The backdrop supports **(a) still images only**. `backdrop` is relative to the fragment file. The 3D `model` is relative to edit.json; do not confuse these base directories. The host binds fragment-relative assets to project inputs, resolving them to localhost serving URLs in preview and image data URIs for export. Do not put http(s): or data: directly in declarations.

(b) Passing the same video as the track below, and (c) having the engine supply the composited under-frame, are future paths. Currently, glass reflects the declared image; it does not automatically capture the video below. Omission of the backdrop passes validation, but the normal host calls `render(..., {})`, so an explicit image is required.

## Declarative fragment schema

Within one root, include exactly one non-executable JSON declaration and at least one `[data-akari-glass]` element. The runtime creates the canvas. Give each surface position, dimensions, and pixel-unit corner radii; put text in front of the canvas.

```html
<div class="glass-card">
  <style>
    .glass-card__surface {
      position: relative; width: var(--button-width, 280px); height: var(--button-height, 90px);
      border-radius: var(--button-radius, 36px);
      --glass-tint: var(--lg-tint, 0.06);
      --glass-blur: var(--lg-blur, 2.5);
      --glass-edge-intensity: var(--lg-lens, 0.035);
      --glass-rim-intensity: calc(var(--lg-lens, 0.035) * 3.7);
      --glass-rim-distance: var(--lg-lens-width, 0.6);
      --glass-ripple: var(--lg-ripple, 0);
    }
    .glass-card__label { position: relative; z-index: 1; color: var(--lg-text-color, #fff); }
  </style>
  <div class="glass-card__surface" data-akari-glass><span class="glass-card__label">再生する</span></div>
  <script type="application/json" data-akari-glass-scene>{"backdrop":"backgrounds/rooftop.jpg"}</script>
</div>
```

From `variants/press.html`, refer to the same backdrop as `../backgrounds/rooftop.jpg`. The asset's meta.json declares `requires: ["glass-runtime"]`.

## Nesting

Putting another `[data-akari-glass]` inside a `[data-akari-glass]` makes the child refract the parent's canvas. Render in parent → child document order. Do not feed the background image to the child again in place of the parent canvas. Because a child gets cloudier, inspect its tint. Make a circle square and use px, not %, for its corner radius.

## Knobs — raw values and product recipe

The runtime reads `--glass-*`. Product fragments map from `--lg-*` in a two-layer arrangement. In video `overlays[].vars`, normally adjust `--lg-*`. These are PoC product-recipe defaults, **distinct from raw-value defaults**.

| Variable | Default | Meaning |
|---|---|---|
| `--lg-tint` | 0.06 (original 0.2) | White-gradient mix; larger is cloudier |
| `--lg-blur` | 2.5 (original 5) | Blur |
| `--lg-lens` | 0.035 (original edge 0.01) | Edge refraction; rim maps to 3.7 times this |
| `--lg-lens-width` | 0.6 (original 0.8) | Lens-band decay; smaller is wider |
| `--lg-ripple` | 0 (original 0.1) | Edge ripple |
| `--lg-scale` | 1 (drag is 2) | Multiplier for size, text, shadow, and paths |
| `--lg-press-at` / `--lg-press-step` | 1s / 0.7s | Press i = at + i × step |
| `--lg-drag-scale` | 1.07 | Scale when grabbed |
| `--lg-text-color` / `--lg-font` / `--lg-shadow` / `--lg-flash` / `--anim` | #fff / system-ui / 1 / 1 / 1 | Text, font, shadow, flash, animation omission |

`--glass-warp` / `--glass-base-intensity` / `--glass-base-distance` / `--glass-edge-distance` / `--glass-corner-boost` can inherit raw values and be fine-tuned. Do not use reserved `--x` / `--y` / `--scale` / `--rotate` for custom purposes.

## Deterministic motion and prohibitions

The host seeks CSS/WAAPI to localSeconds and then calls `glassRuntime.render(container, localSeconds, {})`. During initialization, poll `inspect(container).status` every 10 ms until ready / error. On hide or unmount, release GPU resources with `dispose(container)`.

Arbitrary scripts, wall-clock time, unseeded randomness, and `backdrop-filter` are forbidden. Keep ripple at its default 0; do not raise it unintentionally and make the edge wavy. Do not let grab and release transform animations compete on one element; combine them into one or separate layers.

## Verification and pitfalls

Seek back and forth to the same time and compare PNG md5 hashes. Even at 9:16 (1080×1920), cover the backdrop with center / cover and verify the surface and the underlying background line up. Do not change GLSL cover mapping, premultiplied-alpha output, or parent → child order. Hosts that inline the runtime must escape `</script` through `inlineScript()`. Use `validate-asset` to check backdrop existence and glass surfaces; compare 2D / 3D sheets without glass declarations too.
