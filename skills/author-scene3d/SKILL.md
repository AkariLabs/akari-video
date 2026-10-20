---
name: author-scene3d
description: "Author 3D scenes for AKARI Video: Three.js + glTF motion parts by default, or bake a 3D recipe (scene.py) to MP4 with headless Blender only when the declarative runtime cannot produce the image. Use for 3D, Three.js, glTF, 3D text, device mockups, baking a 3D scene, and Blender. （旧名: bake-3d）"
---

# Author 3D scenes

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

3D is one skill with two paths. Choose by the **capability you need**, not by where the result sits.

## Choose the path (decide this first)

| | Live 3D (**default**) | Blender bake (exception) |
|---|---|---|
| What | A Three.js + glTF motion part: a non-executable JSON declaration drawn by the bundled runtime | A recipe (`scene.py`) baked to MP4 with headless Blender, then placed as ordinary footage |
| Iteration | Fix the fragment and rerender in minutes | Re-bake takes on the order of 10 minutes |
| Compositing | Transparent over the video; a screen can play video | Always carries an opaque background, so the composite needs continuous background-color matching |
| Leaf | [live.md](live.md) | [bake.md](bake.md) |

Default to live. Choose the bake **only** when at least one condition applies:

1. The image **cannot be expressed by the declarative runtime**: depth of field, motion blur, ray-traced reflections, GI, particles, or complex shaders.
2. **Three or more simultaneous 3D scenes** exceed the export performance budget; bake some down to two or fewer.
3. **Deliver a reusable clip to the asset library**, with the recipe as the SSOT asset.

"I want it on the timeline as a clip" is **not** a reason to bake. For custom opening, closing, or rotation motion, bake the clip into a glb and play it through live 3D. If unsure, try live first; falling back after a real blocker is faster than rebuilding an unnecessary bake (an actual production on 2026-08-04 chose the bake where live sufficed and incurred rework).

## Read the right leaf

- Three.js + glTF live scenes (declarative schema, 3D text, physics, camera, video textures, performance): [live.md](live.md)
- Device screens, key legends, and PBR material tuning during generation: [device-materials.md](device-materials.md)
- Bake a recipe (`scene.py`) to MP4, verify it, and place it: [bake.md](bake.md)
- A 3D fragment is still an overlay fragment: follow the hard rules for CSS variables, timing, and determinism in [overlay-authoring/SKILL.md](../overlay-authoring/SKILL.md).

Camera-keyframe moves (`camera.keys`) and billboard 3D text (`texts[].billboard` / `screenSpace`) are documented with examples in the user guide: [Motion parts and captions — 3D](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/overlays-and-captions.md#3d) (Japanese: [テロップ・字幕・図表・3D](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/overlays-and-captions.ja.md#3d)).

## Hard rules

1. **Use one 3D approach.** Three.js + glTF for live scenes, or the Blender bake above. Do not introduce another 3D engine or a third path.
2. **Never report that a 3D scene rendered or baked successfully without watching the actual output.** For live 3D, render through `render-cut` and inspect frames; for a bake, check with `ffprobe` and inspect the first, middle, and last frames.
3. **Determinism.** The image is a pure function of local time: no wall-clock time, `Date.now()`, accumulated rAF deltas, `THREE.Clock` deltas, or unseeded randomness. A bake is the same recipe + same params + same Blender version → the same video.
4. **No external network at render time.** Pin Three.js, decoders, models, textures, and fonts locally; never load them from a CDN. Never turn a failed load into an empty canvas reported as success.
5. **Do not install Blender without the user's approval** (same rule as [setup-library/tools-check.md](../setup-library/tools-check.md)).
6. **Respect licenses.** Never bundle a model, HDRI, or texture of unknown license (follow [harvest-asset](../harvest-asset/SKILL.md)).
