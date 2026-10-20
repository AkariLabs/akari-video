# Live 3D: Three.js + glTF authoring

This leaf is the default path. The decision table — including the conditions that justify a Blender bake instead — lives once in [SKILL.md](SKILL.md).

## Current implementation gate

In live preview v0, a trusted runtime reads non-executable JSON declarations in the fragment and draws static scenes and embedded animation clips from local `.glb` files. Arbitrary fragment JavaScript does not run. Model paths relative to edit.json become preview-only localhost asset URLs. Three.js core and GLTFLoader are bundled as pinned IIFEs.

Export (render-cut) runs the same Three.js runtime through GPU / OSR and embeds local `.glb`, video textures, and environment-map images as self-contained data URIs to burn in the 3D overlay.

Export **seeks the video to frame precision, waits until its presented frame is settled, and only then draws 3D**. Reversing this order uploads the preceding `<video>` frame into the texture; the old order was measured to lag exactly one frame throughout.

Basis: `packages/overlay-runtime/src/overlay-runtime.js`, `packages/overlay-runtime/src/three-runtime.js`, [WHATWG HTML — scripting](https://html.spec.whatwg.org/dev/scripting.html)

## Declarative fragment schema (preview v0)

A fragment has one root, a transparent canvas, an optional static fallback, and exactly one non-executable `<script type="application/json" data-akari-3d-scene>`.

```html
<div class="product-spin">
  <canvas class="product-spin__canvas" data-akari-3d-canvas></canvas>
  <div data-akari-3d-fallback>3D を読み込み中</div>
  <script type="application/json" data-akari-3d-scene>
  {
    "model": "assets/models/product.glb",
    "camera": {
      "position": [0, 1.2, 3],
      "fov": 45,
      "near": 0.1,
      "far": 100,
      "lookAt": [0, 0.5, 0]
    },
    "environment": {
      "intensity": 1.0,
      "exposure": 1.0,
      "map": "assets/env/studio.png"
    },
    "shadows": true,
    "lights": [
      { "type": "ambient", "color": "#ffffff", "intensity": 0.35 },
      {
        "type": "directional",
        "color": "#ffffff",
        "position": [2, 3, 2],
        "lookAt": [0, 0.5, 0],
        "intensity": 1.2
      }
    ],
    "materialOverrides": {
      "ScreenMaterial": { "texture": "assets/screens/app-01.png" }
    },
    "animationClip": "Idle"
  }
  </script>
</div>
```

Only these top-level keys are supported: `model` / `camera` / `environment` / `fog` / `background` / `lights` / `animationClip` / `materialOverrides` / `finishes` / `shadows` / `texts` / `physics` / `terrain` / `lines` / `renderer`. When `texts[]`, `terrain`, or `lines[]` exists, `model` is optional (see their sections). `physics` gives `texts[]` falling physics (see its section).

- `model` is a `.glb` path relative to the directory containing edit.json. Never use a URL or CDN.
- `renderer` is `"webgl"` (default) or `"webgpu"`; omit it for the existing look. This is a per-scene opt-in: only a scene that declares `"webgpu"` uses `WebGPURenderer`. The preview, `render-cut --engine gpu`, and `render-cut --engine osr` all honor it. On a machine without WebGPU, the renderer automatically falls back to its WebGL2 backend, so the declaration still works (check `inspect().renderer.backend` to see which backend actually ran). **Do not change the default for production scenes until you have compared both backends on real footage** (owner decision, 2026-10-21).
- `camera` is perspective. `position` / `lookAt` are `[x, y, z]`; `fov` / `near` / `far` are numbers. Alternatively, `{ "fromModel": "<GLB camera node name>" }` (a GLB camera node name) uses a camera in the GLB (see "Moving the camera").
- `environment` is an IBL knob. `intensity` controls environment-light strength on PBR materials such as metals; `exposure` controls ACES Filmic tone-mapping exposure. Both must be nonnegative. Defaults are intensity 0.5 and exposure 1.0. Check defaults first, then make small adjustments: `exposure` for clipping, `intensity` for reflection strength. IBL itself (default environment map and tone mapping) is always active in preview and export. The `environment` key is optional fine-tuning.
- `background` is `{ "color": "#rrggbb" }`; omission preserves previous behavior and existing assets' appearance.
- `fog` is `{ "color": "#rrggbb", "near": 1, "far": 20 }` or `{ "color": "#rrggbb", "density": 0.05 }`; omission preserves previous behavior.
- **Metal materials get their color only from environment reflections.** If dark, declare `environment: { "intensity": ..., "exposure": ... }`. Default intensity 0.5 with ACES can look much darker than the declared color.
- `environment.map` is a **relative path to an equirectangular image** replacing the procedurally generated default `RoomEnvironment`. It supplies shaped light for hero shots where metals need visible reflections; the default room exposes only a strength scalar and can leave side rails black. Only images, not video, are accepted. Readiness waits for loading, so it will not quietly render the default room instead. **Never raise environment intensity to compensate for a material defect**; remote side effects include milky screens, lost saturation, and clipping.
- `shadows` is a boolean or `{ "enabled": true, "mapSize": 2048, "bias": …, "normalBias": … }`. **Disabled by default** to preserve existing assets. When enabled, it connects shadow maps, mesh cast/receive, and `directional` light casting. The shadow camera fits the model's actual bounding sphere, so even centimeter-size subjects cast shadows. `bias` / `normalBias` defaults also derive from actual size and usually need no declaration. **Meshes with emissive materials do not cast or receive shadows** (they are treated as light sources, so their own shadows cannot dirty them).
- Light types are `ambient` and `directional`; directional lights may declare `position` and `lookAt`.
- `animationClip` names a glTF embedded clip exactly. It also accepts an **array of clip names** or `"*"` to play all simultaneously. Omission draws a static scene. Blender's glTF export splits clips by object, so use `"*"` for a model with several motions; one clip moves only one part. A nonexistent name is an error.
- `materialOverrides` has the form `{ "<material name>": { "texture": "<relative image or video path>" } }` (material name and relative image/video path) and replaces `emissiveMap` on matching materials. **If the target is non-emissive (glTF `emissiveFactor` absent = black), `materialOverrides` alone gives "0 × texture" and shows nothing** (observed 2026-08-14; see the emissiveMap section). Paths are relative to edit.json and may name PNG / JPEG / WebP or MP4 / MOV / WebM, never a URL or CDN. An unmatched material name warns and is ignored.
  - Optional `textureVar` makes screen content a CSS custom-property knob. Name a variable such as `"--screen-src"` and set it to a relative path in overlay `vars` to replace `texture`; if empty or unset, the declared `texture` remains.
  - Even with `textureVar`, keep `texture` as an existing relative path. Pre-export declared-input validation requires a real file. Writing `var(--screen-src)` directly in `texture` works in live preview but fails export.
  - Optional `brightness` is an emissive multiplier from 0 to 4 (default 1) applied to the replaced texture's `emissiveIntensity`. CSS variables such as `var(--screen-brightness)` work in export too. At default 1, `emissiveIntensity` is untouched to preserve existing appearance.
  - Optional `target` chooses where the image is applied. The default, `"emissive"`, replaces `emissiveMap` as above. `"mask"` replaces the material's shape: it converts an image (SVG, PNG, WebP, etc.) to white pixels plus alpha and applies it to the material's baseColor `map`. Use this for a rear logo, sticker, or patch whose outline comes from an SVG. The GLB material and `finishes` supply color and surface quality; image color is ignored.
    - Use a UV-mapped plane with an alpha-blended material (`alphaMode: "BLEND"` in glTF). Bake a default shape into the GLB so older runtimes that do not understand `target` still display it.
    - Prefer transparent images; alpha defines the shape. For opaque images such as JPEG, dark regions define the shape. Fit the full image centered in a square. SVG dimensions can be inferred from `viewBox` when `width` and `height` are absent. Video is unsupported.
    - `fit` ranges from 0 to 1 (default 1) and sets the image's long-edge size relative to the plane. `fitVar` names a CSS custom property that overrides `fit` when nonempty. `fit: 0` removes the logo. `brightness` is unavailable; `fit` and `fitVar` apply only to `target: "mask"`.
    - An unreadable image or SVG does not abort the scene. A warning is emitted and the GLB's baked shape remains (`inspect().materialOverrides[].applied` is `false`, `resolvedFrom` is `"mask-error"`).
    - Rear-logo example: `textureVar` selects an SVG, `fitVar` controls size, and `finishes` links `LogoMat` to the body color:
      ```json
      {
        "materialOverrides": {
          "LogoMat": {
            "texture": "logos/mark.svg", "textureVar": "--logo-src",
            "target": "mask", "fit": 0.65, "fitVar": "--logo-size"
          }
        }
      }
      ```
  - Example declaration wired to knobs:
    ```json
    {
      "materialOverrides": {
        "ScreenMaterial": {
          "texture": "placeholder.png",
          "textureVar": "--screen-src",
          "brightness": "var(--screen-brightness)"
        }
      }
    }
    ```
  - **Paths are relative to the directory containing edit.json, not the fragment directory.** The same applies to `model`. For a fragment at `overlays/3d-phone/fragment.html`, declare `"overlays/3d-phone/model.glb"`; `"model.glb"` looks at the project root and returns ENOENT.
  - **Two major causes of a black or unchanged applied texture** (measured 2026-08-04): (1) **No UVs on the target mesh.** A glTF mesh without `TEXCOORD_0` cannot take a texture. Create uv_layers, planar-project in Blender, and re-export. (2) The destination is `emissiveMap`, so **default black emissive makes the result black**. Set GLB emissiveFactor to white and Emission Strength to 1.0.
- Always give the canvas visible CSS dimensions. A `data-akari-3d-fallback` is hidden only once loading completes. Style it freely; the runtime still hides it at load completion even if it declares `display`.
- Mark the rendering canvas `data-akari-3d-canvas`. Without this marker, two or more canvases cause drawing on the first in document order and warnings from lint (`overlays.three-canvas`) and runtime. Marking two or more, or marking a non-canvas, is an error.
- CSS `rotate()` may be applied to the canvas or its container. Camera aspect derives from `offsetWidth` / `offsetHeight` (fallback `clientWidth` / `clientHeight`), not the rotated bounding rectangle, so rotation does not distort projection and needs no workaround.

## Device screen and key reflections/materials

When generating, replacing, or converting a device mock screen to PBR, read [shared screen/key material generation and comparison](device-materials.md). Specular reflection persists even with an emissive image. Treat screen, keys, legends, and chassis separately, and inspect a glass-screen phone from front and oblique views. Apply shared-generation-helper settings only to explicitly targeted materials; do not work around the problem with project-specific GLB postprocessing or global exposure changes.

## texts[] — 3D text (flat / extrude; introduced 2026-08-12; contract-2026-08-12-3d-text-rail.md)

Adding `texts[]` to `data-akari-3d-scene` declaratively produces per-character 3D telops with troika-three-text (flat SDF text; `renderer: "webgpu"` uses opentype outline meshes instead — see below). **With `texts[]`, `model` is optional**: GLB objects and 3D text may coexist in one scene, while the one-fragment/one-declaration rule remains.

```jsonc
<script type="application/json" data-akari-3d-scene>
{
  "texts": [{
    "id": "title",
    "text": "立体テロップ",
    "window": { "start": 2.0, "duration": 5.0 },
    "mode": "flat",
    "size": 0.8,
    "color": "#ffd166",
    "material": { "doubleSide": true },
    "layout": {
      "type": "line",
      "spacing": 0.78,
      "position": [0, 0, 0],
      "rotation": [0, 0.9, 0]
    },
    "anim": {
      "preset": "char-chaos",
      "speed": 1.0,
      "stagger": 0.055,
      "amplitude": 1.0,
      "seed": 42
    }
  }]
}
</script>
```

- `texts[].id` is a string unique within the declaration. `text` is the displayed string, expanded into an independent troika `Text` per character. Every character, including spaces, expands; layout order follows string order.
- Optional `window` is `{ "start": 0 以上, "duration": 正数 }` (nonnegative start, positive duration) in local seconds from clip start 0. Visibility uses the half-open interval `[start, start + duration)`; the text block is not drawn outside it. Omission displays throughout the clip. `anim.preset` time starts at window time 0, as does falling for `physics` targets.
- Optional `font` follows `model` path resolution: a `.ttf` / `.otf` relative to edit.json, never a URL or CDN. If omitted, the host supplies Zen Kaku Gothic New Black (OFL, `packages/overlay-runtime/test-harness/fonts/`) through `window.akari.threeRuntime.configure({ defaultFontUrl })`. preview-server serves `/__akari/fonts/zen-kaku-gothic-new-black.ttf`; render-cut embeds the same file as a data URI. Without host configuration, omitting `font` produces an explicit error whose message is Japanese.
- `mode` is `"flat"` (troika flat SDF by default; WebGPU scenes use outline meshes, see below) or `"extrude"` (opentype.js outlines extruded with `ExtrudeGeometry`; see the extrude section).
- `size` corresponds to troika `fontSize`, or the opentype em size for extrude (both default `0.5`). `color` is a CSS color string (default `#ffffff`).
- `material` may declare `metalness` / `roughness` / `doubleSide`. **Flat defaults to unlit `MeshBasicMaterial` + `DoubleSide`**, readable without lights. Explicit `metalness` or `roughness` switches to `MeshStandardMaterial`, shaded by scene `lights[]`. `doubleSide: false` enables back-face culling and removes letters on the far side of a cylinder. Extrude always uses `MeshStandardMaterial` and ignores `doubleSide`.
- `layout.type` is `"line"` (default: a centered row with `spacing`) or `"cylinder"` (divide letters evenly around circumference `radius` and face outward). `position` / `rotation` place the whole text block (the parent group of all characters). Changing `rotation.y` gives trapezoidal perspective receding right; unlike corner-pin, perspective is correct for each letter. The **same `charBasePosition` code path** handles flat and extrude, so `layout` keeps its meaning across modes.
- `anim.preset` has five choices through the **same code path for flat and extrude**. In extrude, `char-chaos` dimming is bridged to each character's cloned material `opacity`:
  | preset | Appearance |
  |---|---|
  | `none` | Still (default) |
  | `carousel` | Rotate the whole text block around Y; paired with `layout.type: "cylinder"`, a cylindrical telop |
  | `char-chaos` | Per-character independent rotation, vertical wobble, depth motion, and flickering dim |
  | `flip-wave` | A left-to-right wave of per-character 360° flips |
  | `tumble` | Each character tumbles on a different axis at a different speed |

  Adjust `speed` (time scale), `stagger` (phase offset by character index), and `amplitude` (motion amplitude). **`seed` is required whenever `preset` is not `"none"`** (next section).

### renderer: "webgpu" (opt-in; introduced 2026-10-21)

`"renderer": "webgpu"` draws the whole scene with `WebGPURenderer`. Everything else in the declaration keeps its meaning: model, lights, environment (including `environment.map`), fog, shadows, `materialOverrides`, `finishes`, animation clips, the standard knobs, `texts[]`, and `physics`.

- **Flat text changes implementation, not declaration.** troika does not render on WebGPU (measured: a single square instead of glyphs, no error), so `texts[].mode: "flat"` is built from opentype glyph outlines as `ShapeGeometry` planes. `color`, `material`, `layout`, `window`, `billboard`, `screenSpace`, `anim`, and `physics` all keep the same meaning through the same shared code paths. The visible difference is the letterform itself: SDF rasterization vs. outline mesh (slightly different edge antialiasing and weight). Compare the two before choosing WebGPU for text-heavy scenes.
- **Unsupported flat declarations fail loudly.** The outline path cannot substitute a missing glyph. Characters not present in `texts[].font` (including emoji sequences and combining marks that need shaping) produce a load error naming the character and `texts[].id`. Fonts that opentype.js cannot parse (for example `.woff2`) also produce a load error with the reason. `mode: "extrude"` is unchanged.
- **Background matches WebGL.** WebGPU applies ACES tone mapping to `scene.background` too; the runtime compensates the clear color so `background.color` appears as declared. Do not hand-adjust `background.color` or `environment.exposure` to make the two backends match.
- **Inspect the backend.** `inspect().renderer` returns `{ declared, backend, isWebGPURenderer, initialized }`. On a machine without WebGPU the renderer falls back to its WebGL2 backend automatically (`backend: "webgl2"`); the declaration still works.


### Extrude mode (actual thick letters; introduced 2026-08-12; T3)

`mode: "extrude"` extracts glyph outlines with opentype.js (`window.AkariThree.opentype`) and draws genuinely thick 3D letters through `THREE.ShapePath` → `toShapes(false)` → `ExtrudeGeometry` (extrusion + bevel). Use it for hero titles; use lighter flat mode for repeated telops (table below).

```jsonc
"texts": [{
  "id": "title",
  "text": "立体テロップ",
  "font": "fonts/zen-kaku-gothic-new-black.ttf",
  "mode": "extrude",
  "size": 0.85,
  "color": "#ffd166",
  "material": { "metalness": 0.9, "roughness": 0.25 },
  "extrude": { "depth": 0.3, "bevelSize": 0.028, "bevelThickness": 0.04 },
  "layout": { "type": "line", "spacing": 0.92 },
  "anim": { "preset": "carousel", "speed": 0.5, "seed": 7 }
}]
```

- `extrude.depth` / `bevelSize` / `bevelThickness` default to `0.3` / `0.028` / `0.04` (the example values; they may be omitted). `bevelSegments` (2) and `curveSegments` (6) are fixed, not knobs.
- **`toShapes(false)` is fixed**. With `true`, the hole in a handakuten glyph such as `プ` splits into two (measured in a PoC). This is an internal implementation constant, not a knob.
- **Material is always `MeshStandardMaterial`** (metalness defaults to 0 and roughness to 1). There is no unlit fallback as in flat mode, because thickness and bevel need shading. A declared `material.doubleSide` is ignored; back-face culling has no meaning for a closed solid mesh.
- **Prevent unlit results**: Only when **both** `lights[]` and `environment` are undeclared, extrude text makes the runtime add weak default lights (ambient 0.25 + directional 2.0 at `position: [3, 5, 4]`). Declaring either suppresses defaults to respect the declaration. Declare `lights[]` for deliberate shading.
- **Cache glyph shapes and geometry** by `font+char+size+depth+bevelSize+bevelThickness`. Repeated characters in one scene are not retriangulated. Cache lifetime is limited to the mounted instance; unmount releases it and instances do not share it.
- Generation is synchronous at mount except for asynchronous opentype font parsing. `draw(localSeconds)` stays pure as in flat mode, preserving determinism and seek safety.

**Choosing flat or extrude**:

| | flat | extrude |
|---|---|---|
| Substance | Thin troika SDF plane | Extruded opentype outline mesh |
| Thickness / bevel | None | Present |
| Default material | Unlit; no light needed | Lit; fixed `MeshStandardMaterial` |
| Best use | Repeated telops, cylinders, many characters | Hero titles, few characters, metal and shading |
| Relative cost | Light | Heavier triangle mesh per character; eight characters is a comfortable guide (see verification) |

### Determinism (specific to texts[])

`texts[].anim` inherits the "render is a pure function of localSeconds" rule described under deterministic 3D animation below. Implementation details:

- Per-character variation comes only from a deterministic constants table made from `anim.seed` at mount (sin hash, not `Math.random`). Each `draw(localSeconds)` combines that table and trigonometric functions without inter-frame state. Any call order at the same `localSeconds` gives the same pose, supporting seek safety and matching export SHA-256.
- Text with `window` uses `localSeconds - window.start` for animation and physics lookup. Reverse seek before the window clamps to zero; visibility outside it uses only the same half-open interval check.
- Completion of troika `sync()` (glyph resolution) is part of scene readiness, so empty SDF loading frames never enter export.
- **Missing glyphs (emoji or other characters absent from a font) never trigger external network access.** troika-three-text can fetch a fallback font from `cdn.jsdelivr.net` (unicode-font-resolver), but the runtime blocks only that CDN `fetch()` through `disableTroikaUnicodeFontFallback` in `three-runtime.js`. `unicodeFontsURL` controls where, not whether, fetching happens, so the fetch-level block is necessary. Missing glyphs become tofu (not drawn) and export silently continues.
- For extrude, opentype.js independently `fetch()`es and parses `texts[].font`, separate from troika's XHR path. In export, `embedThreeModels` in `rasterize.mjs` embeds the font as a data URI (shared logic with flat), so the fetch resolves to data: without external access.

## physics — falling 3D text (introduced 2026-08-12; contract-2026-08-12-3d-text-rail.md)

Adding `physics` to `data-akari-3d-scene` declaratively drops targeted `texts[]` characters under gravity to bounce against floor, wall, circle, and polygon colliders. **At `createInstance()`, matter-js presimulates for `duration` with `seed` and fixed `dt`, baking each character's (x, y, angle) into a Float32Array keyframe buffer.** `draw(localSeconds)` only does a clamped, linearly interpolated lookup in that buffer. It therefore preserves the previous section's pure-function rule for rendering from localSeconds.

```jsonc
<script type="application/json" data-akari-3d-scene>
{
  "texts": [{
    "id": "fall",
    "text": "物理落下テスト",
    "font": "fonts/zen-kaku-gothic-new-black.ttf",
    "mode": "flat",
    "size": 0.5
  }],
  "physics": {
    "enabled": true,
    "seed": 7,
    "duration": 6.0,
    "dt": 0.008333,
    "gravity": [0, -1],
    "restitution": 0.35,
    "targets": ["fall"],
    "colliders": [
      { "type": "floor", "y": -2.6 },
      { "type": "wall", "x": 5.6 }, { "type": "wall", "x": -5.6 },
      { "type": "circle", "center": [1.7, -0.05], "r": 0.62 },
      { "type": "polygon", "points": [[-1.3,-2.6],[1.3,-2.6],[0.85,-0.9],[-0.85,-0.9]] }
    ]
  }
}
</script>
```

- `enabled`: Defaults to `true` when `physics` exists. Set `false` to temporarily disable only the effect while retaining its declaration.
- `seed` (**required**): Pseudorandom seed for presimulation's initial positions, angles, and angular velocities. Never use `Math.random` or wall-clock time. **Seed gacha**—trying several presimulations with only the seed changed and picking a pleasing one—is a practical tuning method; there is no API for directly specifying each character's falling path.
- `duration` (**required**): Presimulation time in seconds. **Use at least the overlay's timeline `duration` as a recommendation.** If shorter, the tail of the overlay remains clamped at the presimulation's final pose. It is not an error, but may appear to freeze midway.
- `dt`: Fixed step (default `1/120`). A larger step accelerates presimulation but reduces precision.
- `gravity`: `[x, y]` (default `[0, -1]`) in the same y-up scene space as `camera` / `lights`.
- `restitution`: Bounce coefficient (default `0.45`); near 0 sinks, near 1 bounces more.
- `targets`: **Required, nonempty** array of `texts[].id` physics targets. Their characters ignore `layout.position` / `layout.rotation` and use absolute scene coordinates shared with `colliders` / `gravity`; simulation sets the apparent position of the text block. **Only `start="layout"` is an exception** (below).
- `colliders`: Static array of `floor` (`y`), `wall` (`x`), `circle` (`center`, `r`), or `polygon` (`points` as scene-coordinate `[[x,y], ...]`; **concave polygons allowed**). About 25–60 vertices is a practical guide for simplified person silhouettes (T5 spike measurement); above the limit of 200 is a validation error.
- Optional `spawn` (introduced 2026-08-14): Targeted rectangle for initial character positions, `{ "x": [min, max], "y": [min, max] }`. **Without it, retain the old fixed five-lane grid** (`x=(col-2)*1.1`, `laneCount=5`), which cannot directly target a narrow subject such as a head or shoulders. In an internal measurement, an exhaustive search of 242 seeds put no letter within a head-width band of ±0.9; inability to target spawn was the blocker. With `spawn`, draw initial positions from its `spawn.x` / `spawn.y` rectangle with a **seed-derived deterministic uniform distribution**, never `Math.random`; the same seed and character index always yield the same position. A narrow rectangle just above the intended subject avoids large landing errors without seed hunting.

```jsonc
"physics": {
  "seed": 5, "duration": 3.0, "targets": ["fall"],
  "spawn": { "x": [-0.5, 0.5], "y": [1.0, 1.6] },
  "colliders": [
    { "type": "floor", "y": -5.0 },
    { "type": "circle", "center": [0, -1.0], "r": 0.5 }
  ]
}
```

  - Both `x` and `y` require `min < max`; violations are errors.
  - The `spawn` rectangle must fit inside collider `floor` / `wall` boundaries. At or below `floor.y`, or outside `wall.x`, is **an error, not a warning**; spawning outside a wall or floor is almost certainly accidental.
- Optional `start` (default `"spawn"`; introduced 2026-08-14) chooses initial presimulation placement:
  - `"spawn"` (default) derives a pseudorandom position from the rectangle above, or from the fixed five-lane grid if omitted, as before.
  - `"layout"` initializes position and rotation **from `texts[].layout`**. Use x/y from `layout.position` and z from `layout.rotation` (2D in-plane rotation; matter-js only represents x/y and z-axis rotation). Preserve `layout.type: "line"` order and `spacing`. **No randomness is used, so determinism is immediate**; changing `seed` does not change initial layout. Declaring `spawn` simultaneously is an error to avoid ambiguous precedence.
- Optional `holdSeconds` (default `0`, **at least `0` and less than `duration`**; introduced 2026-08-14): From presimulation start (`localSeconds=0`), hold target characters static and unaffected by gravity or collisions for this many seconds. Then make them dynamic and let them fall. The buffer still records the same held position every frame, so lookup-only drawing remains seek-safe. Paired with `start="layout"`, a readable laid-out telop stays still for `holdSeconds` then collapses.

**Recipe: a horizontal (or slanted) telop collapses** (`start="layout"` + `holdSeconds`):

```jsonc
{
  "texts": [{
    "id": "fall",
    "text": "落ちるテスト",
    "font": "fonts/zen-kaku-gothic-new-black.ttf",
    "mode": "flat",
    "size": 0.4,
    "layout": {
      "type": "line", "spacing": 0.55,
      "position": [0, 1.6, 0],
      "rotation": [0, 0, 0.22]
    }
  }],
  "physics": {
    "enabled": true,
    "seed": 13,
    "duration": 2.5,
    "start": "layout",
    "holdSeconds": 1.0,
    "restitution": 0.35,
    "targets": ["fall"],
    "colliders": [
      { "type": "floor", "y": -2.6 },
      { "type": "wall", "x": 5.6 }, { "type": "wall", "x": -5.6 }
    ]
  }
}
```

`localSeconds` from 0 to 1.0s stays in `layout` order (slanted by `rotation.z`). After 1.0s, it collapses under gravity and piles up at `floor.y`. `seed` affects only falling and bounce after the hold, not initial placement, so vary it to change only how the collapse unfolds.

**Physics and animation are mutually exclusive**: A `texts[].id` in `targets` may not have `anim.preset` other than `"none"`; declaring both is an error. Physics writes per-character position/rotation every frame, so no ambiguous priority between them is allowed.

**Targeting a person silhouette**: v1 `polygon` colliders require hand-authored vertices. Automatic person segmentation → contour extraction → simplification is planned as a future skill and is manual now. To merely aim above a subject, place a `spawn` rectangle over the head and shoulder width.

## Standard knobs (camera projection and material finish)

### Select material finishes

`finishes` declares color and surface coefficients by GLB `material.name`, selected with one CSS custom property. The omitted `var` defaults to `--akari-3d-finish`. `default` must exist within `options`. Option names begin with a letter or `_` and continue with only alphanumerics, `_`, or `-`.

```json
"finishes": {
  "var": "--akari-3d-finish",
  "default": "natural-titanium",
  "options": {
    "natural-titanium": { "FrameMat": { "color": "#c5c2b9", "metalness": 1, "roughness": 0.35 } },
    "cosmic-orange": { "FrameMat": { "color": "#d66b33", "metalness": 1, "roughness": 0.4 } }
  }
}
```

Per-material keys are `color` / `metalness` / `roughness` / `clearcoat` / `clearcoatRoughness` / `emissive`. Colors are six-digit `#rrggbb`; numbers range from 0 to 1. Names absent from the model and unsupported material properties warn and are ignored. At every selection change, reset each material to its post-`materialOverrides` value, then apply only the selected keys, leaving no values from the prior selection. Textures are never touched.

```css
.phone-live { --akari-3d-finish: var(--phone-finish, natural-titanium); }
```

Declare the asset `meta.json` knob with the existing `cssVar` binding. Allowed values must match `finishes.options` keys. Metadata has no `options` array; enumerate choices in `label`.

```json
{ "cssVar": "--phone-finish", "type": "dropdown", "group": "style", "label": "本体の仕上げ（natural-titanium / cosmic-orange）", "default": "natural-titanium" }
```

An empty CSS value uses `default`; an unknown value warns once and also uses `default`. `materialOverrides` owns `emissiveMap` and `emissiveIntensity` (brightness); `finishes` owns `color` / `metalness` / `roughness` / `clearcoat` / `clearcoatRoughness` and emissive color. Apply `materialOverrides` first and record that result as base values; then `finishes` changes only selected keys, preserving `emissiveMap` and `emissiveIntensity`. A map on a non-emissive material can display if `finishes` sets `emissive` to white. Preview and export apply the same path.

### Camera-projection pan / zoom

The runtime interprets three **standard custom properties**: `--akari-3d-pan-x`, `--akari-3d-pan-y`, and `--akari-3d-zoom`. When declared on the fragment root or an ancestor, the runtime reads them every draw and changes **camera projection** through `setViewOffset` and `fov`. It never changes camera position, model pose, or lights, avoiding interference with baked animation clips.

| Property | Meaning | Unit |
|---|---|---|
| `--akari-3d-pan-x` | Subject's horizontal position as fraction of frame width | `%` suffix or unitless fraction (`50%` = `0.5`) |
| `--akari-3d-pan-y` | Subject's vertical position as fraction of frame height; positive goes down, like CSS `translate` | Same |
| `--akari-3d-zoom` | Apparent size multiplier; `1` is default | Unitless |

**Use proportions, never px.** Preview may be scaled for display. Pixels would tie the image to that display scale and break preview/export parity; proportions match independently of scale.

### Replace the live path's canvas-moving CSS

Previously, asset knobs (`--<asset>-x` / `--<asset>-y` / `--<asset>-scale`, etc.) **moved the canvas itself with CSS** `transform: translate(...) scale(...)` on the fragment root. This clipped the canvas outside the frame and enlarged already-rendered bitmap pixels, reducing resolution. Bridge to standard knobs to fix both:

```css
.laptop-live {
  position: absolute; inset: 0;
  --akari-3d-pan-x: var(--laptop-live-x, 0);
  --akari-3d-pan-y: var(--laptop-live-y, 0);
  --akari-3d-zoom:  var(--laptop-live-scale, 1);
}
```

Keep asset-specific knob names such as `--laptop-live-x` and **only map them** to standard properties. Remove `transform`. The canvas always covers the entire frame with `inset:0`; the subject disappears only when it actually leaves the frame. There is no automatic clipping correction, preserving intended offscreen effects.

### Backward compatibility

**With none of the three properties declared, behavior is exactly unchanged.** If `getComputedStyle` finds all three empty (no ancestor declares them), the runtime does not touch `camera.view`, call `setViewOffset`, or rewrite `fov`. Existing CSS `transform` fragments continue unchanged.

### Parity (why preview and export show the same image)

Export (`embedThreeModels` in `packages/render-cut/src/rasterize.mjs`) and live preview (shell / `packages/overlay-runtime/src/overlay-runtime.js`) **inject the same `three-runtime.js` into the same fragment DOM structure**. Properties declared on the fragment root inherit to `<canvas>`. Regardless of caller nesting (with or without `.scene-content`), the same values are read with the same formulas. The store's simple renderer (`mountThreeScene` in `asset-live.js`) is independent of `three-runtime.js`, so **manually port the same formulas and signs**. Otherwise it alone diverges from preview and export.

## Moving the camera (camera.fromModel — camera in GLB + baked clip; introduced 2026-08-11)

Previously the live path fixed camera literal values and approximated motion by moving the model. With a floor and contact shadows, moving the model is not equivalent: rotating it or the stage sweeps shadows across the floor and changes lighting. A glTF clip can now move the camera itself as **data**, while preserving the declarative contract (no executable code in shipped assets).

```json
"camera": { "fromModel": "ShotCam" },
"animationClip": "CamOrbitDollyIn"
```

- `fromModel` is a GLB camera-node name, or `true` for the first camera. It uses GLB yfov / znear / zfar and **warns and ignores** accompanying literal `position` / `lookAt` / `fov` etc. Aspect comes from actual canvas size as with literal cameras.
- Camera motion uses the existing `animationClip` syntax (name / array / `"*"`) and can coexist with model-motion clips in an array. `mixer.setTime` evaluates camera-node TRS too, preserving pure time-based deterministic rendering.
- Standard pan / zoom knobs **compose over the baked path**. Zoom uses the GLB yfov as its base.
- Only perspective cameras are supported. **Cameras outside the scene tree** (only in `gltf.cameras`) cannot be animated because the clip cannot reach their node. Put the camera in a Blender collection and export again.
- Check `inspect()` `cameraSource` (`"model"` means wired) and `cameraWorldPosition` (actual post-clip position) to verify camera wiring and motion without image comparison.

### Camera rig and bake traps (measured in a 2026-08-11 spike)

- **Core glTF cannot animate camera yfov**; animation covers only node TRS and weights. Zoom in with dolly translation; a dolly zoom needs a future declarative-keyframe extension.
- Blender constraints such as `TRACK_TO` do not export to glTF. **Maintain aim in rig structure**: yaw (at pivot, Y rotation) → pitch (X rotation) → camera (+Z offset for dolly, Z rotation for roll). A glTF camera looks along its node's -Z; a child camera at parent +Z keeps facing the pivot with identity rotation, so TRS keys alone preserve aim.
- Separate nodes per axis because **a single node path cannot have multiple channels**. Bake simultaneous yaw, pitch, and roll on three nodes.
- Angle meaning, including pitch sign, depends on rig structure. **Always settle it with both actual renders and `cameraWorldPosition`**, as with the rule against assuming a model's default pose is neutral.
- The clip-length = window-length rule applies to camera clips too (LoopRepeat). Normal half-open visibility avoids it, but passing **t = exact duration** to a QA renderer shows the wrapped initial image: `setTime(6.0)` on a six-second clip shows time zero.

## Declarative camera keys and billboard text

`camera.keys` (keyframe camera moves without a GLB clip) and `texts[].billboard` / `screenSpace` (text that always faces the camera at a constant on-screen size) are documented with examples in the user guide: [Motion parts and captions — 3D](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/overlays-and-captions.md#3d) (Japanese: [テロップ・字幕・図表・3D](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/overlays-and-captions.ja.md#3d)). Preview, `akari capture`, and export share the same interpolation, so the same `t` gives the same camera.

## terrain and lines (height-map terrain and growing 3D polylines; introduced 2026-10-21)

`terrain` builds a mesh from a PNG height map and `lines[]` draws screen-width polylines. Neither needs a GLB or a Blender bake. The user guide carries the full prose and the same examples: [Motion parts and captions — 3D](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/overlays-and-captions.md#3d).

```json
{
  "terrain": {
    "heightmap": "overlays/3d/height.png",
    "texture": "overlays/3d/photo.jpg",
    "encoding": "grayscale",
    "exaggeration": 1.5,
    "size": [12, 8],
    "segments": 256
  }
}
```

- `heightmap` is a PNG path. Declare it from the project root (for example `overlays/3d/height.png`) so preview and export resolve the same file; lint also accepts a path next to the fragment. `encoding` is `"grayscale"` (default; luminance = height) or `"gsi-dem"` (GSI elevation tiles: RGB encodes elevation, `-10000 + raw * 0.01` metres; the `0x800000` no-data pixel becomes 0).
- `size` is `[width, depth]` in world units (default `[10, 10]`). `exaggeration` (default 1, 0.01–100) multiplies the sampled height. `segments` (1–512) sets the grid; omitted, it follows the image resolution capped at 512.
- `texture` pastes a still photo. Without it the terrain is a single color shaded by height. The runtime waits for both images before `status: "ready"`, so capture and export never see a partially loaded terrain. Check `inspect().terrain` (image size, `segments`, `minHeight`, `maxHeight`).
- Keep the height map inside the project. A `data:` PNG is also accepted when the file must travel with the declaration.

```json
{
  "lines": [{
    "points": [[-4, 1, 0], [0, 3, 0], [4, 1, 0]],
    "color": "#ff3366",
    "width": 4,
    "keys": [
      { "t": 0, "progress": 0 },
      { "t": 2, "progress": 1, "ease": "easeInOut" }
    ]
  }]
}
```

- `points` needs 2 or more `[x, y, z]` finite numbers. `width` is in screen pixels and stays constant with distance (the runtime expands each segment in screen space; no `LineMaterial` dependency).
- `progress` (0–1) draws from the first point. `keys` (`t` in seconds from the item start, `progress`, optional `ease: "linear" | "easeInOut"`) animates growth; before the first and after the last key the value holds. Keys must be ascending and are not sorted automatically. `keys` wins when both are declared.
- The geometry is rebuilt inside `draw(localSeconds)` from the final camera, so preview, `akari capture`, and export share the same picture. Check `inspect().lines[]` (`progress`, `vertexCount`) without pixel comparison.
- `akari lint` (`overlays.three-terrain` / `overlays.three-lines`) checks the image exists and is a PNG, the ranges, point count, colors, widths, progress, and key order before export.

## When export fails with `seeking frame N timeout`

Export runs a GPU / OSR WebGL renderer. It draws a 1920×1080 scene on the CPU every frame, so **more simultaneous 3D scenes make each frame heavier** and can hit a 60-second watchdog, failing the entire export. Measured on an M-series Mac, 2026-08-04:

| Simultaneous 3D scenes | Seek per frame | Result |
|---|---|---|
| 1 | Tens of ms | Stable (8/8 succeeded) |
| 2 | Hundreds of ms | Mostly stable (rare failures) |
| 3 | Gradually 300 → 1500ms | Repeated failures (sometimes page freezes) |

- **Aim for no more than two simultaneous scenes.** With three or more, stagger shots in time rather than overlapping them.
- On failure, warnings report recent frame time, scene count, and page diagnostics. **Growing times imply excessive load; a freeze without growth suggests another cause.**
- Never infer the timeout cause from correlation alone. Change **one variable at a time and repeat runs** before claiming causality. In 2026-08-04 production, both "custom animated GLB caused it" and "environment knob caused it" were rejected; the actual cause was the performance limit above. Diagnostics aim to avoid those two misdiagnoses.

## Principles

- Use only Three.js for 3D and glTF-family exchange. Preview v0 accepts self-contained `.glb` without external buffers and local images named by `materialOverrides`. Draco/KTX2 is unsupported.
- Pin Three.js core, addons, decoders, models, and textures locally; do not import from a CDN. The export executable disables background networking.
- Restrict fragments to the declarative schema above. Never use arbitrary scripts, event handlers, `new Function()`, etc.
- Put a transparent canvas and static fallback under one root. Enable transparent compositing; do not paint the background opaque.
- Preview loads, renders, and decodes assets only while visible and frees geometry, materials, textures, and renderer outside the interval and at unmount. OSR export creates an instance two seconds before the interval (loading in background), waits for ready before first drawing in the interval, then disposes after it. GPU export creates all instances at startup and retains them during export (known difference; follow-up work).
- Expose camera, lights, model pose, materials, and screen source as CSS-variable or asset-metadata knobs. Do not make fixed model topology a knob.

## Licensed GLB

1. Check source, asset ID / version, author, acquisition date, license, commercial permission, modification permission, and attribution.
2. Do not mistake glTF format for a license. Never use a model with unknown licensing.
3. Copy `.glb` and required textures / decoders into the adopted project, rather than linking from the library.
4. Record source library, version, license, and attribution in project provenance.
5. Load by relative URL and never call an empty canvas after a load error a success.

Follow `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-asset-library.md` for library-copying rules.

## Deterministic 3D animation

- Preview v0 passes overlay local timeline seconds to `AnimationMixer.setTime(localSeconds)` and renders only that state.
- Never accumulate time through `THREE.Clock` or `mixer.update(delta)`. Derive camera, shader time, and particles from the same local timeline.
- Use rAF only to draw a state for a time already computed; never add rAF deltas to state.
- For motion without a glTF clip, compute pose as a local-time function too. Verify playback, pause, and reverse seek agree.

Official: [Three.js AnimationMixer.setTime](https://threejs.org/docs/pages/AnimationMixer.html#setTime)

### Match clip length to the overlay window (measured 2026-08-04)

With `setTime(localSeconds)`, **clipAction defaults to LoopRepeat**. If the overlay window `duration` exceeds clip length, the clip jumps to its beginning at the excess point and **looks broken** (for example, an open lid instantly closes).

- Two remedies: (a) keep the window within clip length; (b) **rebuild the clip to match window length exactly**.
- Bundled clips often have the wrong length or orientation. When they do, **rebuilding is faster** (see "Edit a GLB directly").

### emissiveMap on a non-emissive material (materialOverrides; measured 2026-08-14)

`materialOverrides` always replaces `emissiveMap`. Three.js multiplies by `emissive` (glTF `emissiveFactor`), so **a map applied to a material with no `emissiveFactor` = black yields "0 × texture" and vanishes completely**. It raises no error, obscuring diagnosis.

Actual failure: An app-icon GLB front face (`IconFaceMaterial`) was non-emissive and stayed **white plastic** despite `materialOverrides`. The same declaration worked on a phone screen (`ScreenMaterial` with `emissiveFactor: [1,1,1]`), making the declaration appear correct.

- Diagnose: Inspect GLB materials before applying a texture; without `emissiveFactor`, it cannot show.
  ```sh
  python3 -c "import json,struct;d=open('model.glb','rb').read();n=struct.unpack('<I',d[12:16])[0];j=json.loads(d[20:20+n]);print([(m['name'],m.get('emissiveFactor')) for m in j['materials']])"
  ```
- Remedy 1 (preferred): Set `emissiveFactor: [1,1,1]` on that model material. Darkening `baseColorFactor` also prevents the base from muddying the texture.
- Remedy 2: Target an emissive material, such as the screen material.
- Remedy 3: Set `"emissive": "#ffffff"` on the same material in `finishes`; `materialOverrides` retains `emissiveMap` and `emissiveIntensity`.
- The runtime **warns** when targeting non-emissive material (added 2026-08-14). Inspect the log.

### Measure front-facing time before using motion presets (2026-08-14)

Rotating `animationClip` presets may **face backward or sideways through most of the display window**. In a one- or two-second overlay, the applied texture may never be visible.

Actual failure: All three app-icon clips (`Turntable` / `PopInDrop` / `TumbleReveal`) showed the icon's back for about the first 1.5 seconds. During a 1.8-second display, only a white face appeared. **The initial pose without `animationClip` faced forward**, so leaving it still was right for short exposure.

- For brief exposure, first render without `animationClip` and check initial orientation.
- If rotation is needed, measure clip phase and align the display window with a front-facing interval.

### Reduce `--akari-3d-zoom` to 0.3–0.5 for small objects over live action (2026-08-14)

The `--akari-3d-zoom` default of `1.0` **fills the frame with 3D**. That is too large for a small icon or device over live action and can overflow the frame. Measured guides: icon 0.30–0.34, actual phone 0.46. Shift position with `--akari-3d-pan-y` (positive moves down).

### Verify 3D by rendering a minimal project (2026-08-14)

A standalone render with `harness/render-fragment.mjs` returns `status=error` for 3D; `model` / `texts[].font` resolve relative to project root and need project context. **Make a minimal `edit.json`, render through `render-cut`, extract frames, and inspect them visually.** Never infer from the fragment alone that a texture worked.

### Never assume "default pose = neutral" for a model (measured 2026-08-04)

For a laptop `lid_root`, rotation 0° (identity quaternion) meant **180° flat and fully open, not closed**. Actual opening angle was `180° − A`, where A is applied X rotation.

| Applied angle A | Actual appearance |
|---|---|
| 0° | 180° flat |
| 100° | Normally open at 80° |
| 180° | Fully closed |
| −100° | Reverse bend of 280° (hinge on the other side) |

**Always determine angle meaning from at least three real rendered samples (both endpoints and middle).** Never infer from model name, axis name, or default value.

### Edit a GLB directly (sometimes more reliable than Blender)

- **Blender `frame_set()` cannot freeze a pose**: Just after glTF import, animation is not evaluated and every requested time exports the default pose. Suspect this if multiple times yield the same image.
- For replacing node rotations or creating animation, **writing the GLB JSON chunk directly is more reliable**.
- Implementation notes:
  - Append to the end of the BIN chunk **on a four-byte boundary**, add `bufferViews` / `accessors`, and reference them from samplers.
  - Update both `buffers[0].byteLength` and the **GLB header's total length**.
  - Time/input accessors **must have `min` / `max`**.
  - Rotation `LINEAR` interpolation uses SLERP; keys equivalent to 30fps can reproduce arbitrary easing.
  - Match static `node.rotation` to the t=0 value to avoid first-draw flicker.

### Bake a texture into a model that cannot accept overrides

`materialOverrides` only affects existing `emissiveMap`; it **cannot structurally work on a material lacking both UV and emissive** (the screen remains black). In Blender, add planar UVs and bake the image as `emissiveTexture` (`emissiveStrength` about 1.2–1.5).

**Render all four UV orientations and inspect them; this is faster** than inferring orientation from bbox axes: `(u,v)` / `(1-u,v)` / `(u,1-v)` / `(1-u,1-v)`. The criterion is whether text reads correctly.

## VideoTexture

`materialOverrides` texture accepts video (`.mp4` / `.m4v` / `.mov` / `.webm`). The runtime creates a DOM `<video>` and a `VideoTexture`. Deterministic export seeks apply to `<video>` under active overlays and to 3D screen videos present in the DOM. Under OSR, inactive 3D is disposed and leaves the DOM.

- **The outer layer always determines time.** Runtime does not `autoplay`; never rely on wall-clock playback.
  - **Export**: Rasterization completes a frame-precise seek and waits for the presented frame before drawing 3D. Runtime does not set `currentTime`.
  - **Preview**: Each tick passes `render(container, seconds, { syncVideos: true, playing })`; runtime aligns to overlay local time (revised 2026-09-16). **During playback (`playing: true`), run `<video>` and correct drift through `playbackRate` up to ±0.25.** Hard-seek only if drift reaches one second. **When paused or scrubbing, seek through `currentTime`**, but do not queue a new seek until the preceding `seeked` event. Seeking every tick repeatedly decodes from keyframes, leaving a black or flickering screen until a seek finishes. If seeks do finish, frame-engine slows the timeline (measured 0.2–0.5×). Since preview advances on wall-clock time without waiting for a settled presented frame, it can differ by about one frame.
  - `syncVideos` is **preview-only opt-in**. Passing it in export disrupts the settled presented frame and breaks determinism.
- Runtime creates `<video loop>`. Export seeking folds time by duration for looped media, so a composite longer than the media loops instead of freezing at the end.
- Supply an **editing 720p proxy**; never connect the original to the texture. Export embeds video as a data URI (base64 adds about 1.37×), so an original inflates the sheet and preview must seek it every tick.
  - **Export rejects video textures above 24MiB**; it never silently falls back to the original. The error provides an ffmpeg command to make a 720p proxy: `ffmpeg -i <master> -vf scale=-2:720 -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -an <proxy>.mp4`.
  - The check uses bytes instead of resolution because sheet generation is synchronous and pure and does not call ffprobe. It is a proxy for "is it 720p?"; the size ceiling itself can be tuned operationally.
  - Automatic generation of timeline-media `source.proxy` in edit.json is separate and not yet implemented.
- Runtime enables mipmaps (`LinearMipmapLinearFilter` + anisotropy 16). `VideoTexture` defaults them off; shrinking a large source to a small 3D surface breaks details, and rotation changes the breakup each frame, appearing jittery.
- Set the target surface's **baseColor to black**. Otherwise a brightly lit surface swallows the emissive picture. A mesh without UVs cannot accept it and samples (0,0), looking black.
- Match the source aspect ratio to the target. A portrait video on a landscape screen stretches.
- When source dimensions or format change, dispose and rebuild the existing texture.
- During paused preview and scrubbing, seeking requires an **editing 720p proxy** or stalls. Never use the original. Do not write `currentTime` when already within 20ms; do not queue seeks during an active seek.
- Create `<video>` with `crossOrigin="anonymous"`. The shell serves live-preview media from another origin (`127.0.0.1` asset stream with `Access-Control-Allow-Origin: *`). Without CORS, the canvas is tainted, WebGL transfer fails, and **the screen is black**. Still images worked because `TextureLoader` enables CORS by default. The setting is harmless for same-origin or `file:`.
- In live preview, upload to GPU **only when the presented frame changes** (`requestVideoFrameCallback`). Unconditional `needsUpdate` each tick slows frame-engine. Export without `syncVideos` continues uploading on each draw.

Official: [Three.js VideoTexture](https://threejs.org/docs/pages/VideoTexture.html)

## Performance

- Do not use post-process blur, `filter: blur()`, `backdrop-filter`, or excessive shadows over 4K.
- Enabling `shadows` adds shadow-map depth passes (measured draw calls 2 → 4 in a simple scene). Declare it only for cuts that need it.
- Video textures upload to GPU every frame, regenerating mipmaps each time.
- Avoid object/material/texture creation, shader compilation, or model reload every frame.
- Preview v0 and export fix renderer pixel ratio at `1`. Measure the same scene's appearance at the target output profile.
- Measure draw calls, triangles, and textures with `renderer.info`. There is no primary basis for a universal polygon or draw-call cap: do not invent one; mark performance **needs verification** on the target Mac and output profile.

Official:

- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Three.js — How to dispose of objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

## Common mistakes

- Depending on CDN Three.js, decoders, or textures.
- Passing Draco / KTX2 compressed models to v0 (decoders and workers unsupported).
- Bundling a `.glb` of unknown license as "something found online".
- Trying to execute fragment `<script>` instead of using JSON declarations.
- Reporting WYSIWYG support based on export alone.
- Sending the original to `VideoTexture` because no proxy is available.
- Raising `environment.intensity` to disguise a missing material texture, causing effects elsewhere.
- Naming only one `animationClip` for a model with several motions and shipping a partly frozen model.
- Letting an overlay window exceed clip duration, looping and breaking midway.
- Assuming the model's default pose is "neutral" (closed or front-facing) without measuring angle meaning in a real render.
- Believing Blender `frame_set()` froze a pose when animation was unevaluated and the default pose exported.
- Animating with `Clock.getDelta()` / `mixer.update(delta)`.
- Continuing render loops and video decoding when hidden.
- Failing to dispose and leaving GPU resources after each asset switch.
