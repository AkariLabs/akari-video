**English** | [日本語](./bake-3d.ja.md)

# Bake a 3D scene

The default path for 3D is **live 3D** drawn with Three.js (motion parts; `overlay-authoring`).
Baking is the **other path**, for images that path can't produce: it uses Blender to **bake a 3D
scene into video footage**. The skill is `bake-3d`. The baked footage goes into `edit.json` as an
ordinary clip.

On screen, a bake recipe is called **3D settings** (an item in the asset filter, and "3D settings"
under Connections). In the CLI, files, and skills it is still recipe / `scene.py`.
(The `akari recipe` command is a different thing: it checks procedures that use external tools.)

## When to use

Choose baking only when at least one of these applies:

- You need an image Three.js's declarative rendering can't produce: depth of field, motion blur,
  ray-traced reflections, GI, or particles
- Three or more 3D scenes appear at once and the export load is too high (bake some so two or fewer remain)
- You want to deliver a reusable clip to the asset library

"I want it as a timeline clip" alone is not a reason to bake. A baked clip carries an opaque
background, and re-baking takes on the order of 10 minutes. For opening, closing, or rotation
motion alone, bake the animation into a glb in Blender and play it through the Three.js path.

## How it works — the recipe model

3D scenes are managed as "recipes" (`scene.py` plus a parameter declaration).

- A recipe is a reproducible script that runs Blender headless and bakes it to mp4
- Adjustable points such as color, text, and speed are declared as parameters, so you
  can re-bake by changing values alone, without touching Blender
- The baked output goes to `bakes/*.mp4` and is used as **an ordinary clip in edit.json**
- The same recipe, parameters, and Blender version give the same video (nothing depends on wall-clock time or random numbers)

## How to ask

- "make a 3D opening with a spinning logo"
- "change this 3D setting's text to 'Episode 2' and re-bake"
- "check it quickly with draft, and if it looks good, do final" (`--profile draft / final`)

## Flow

1. Pick a recipe or create a new one (search the catalog / library)
2. Confirm parameters → run the bake (Blender headless)
3. Verify the output (duration, resolution, and a look at the first, middle, and last frames)
4. Place it in the project, or [add it to the library](./asset-library.md)

## Three.js vs. baking

| | Live 3D (overlay-authoring; the default) | Baked (bake-3d) |
|---|---|---|
| What it is | A motion part drawn with Three.js (loads a `.glb`) | An mp4 clip baked in Blender |
| How touchable | Instantly adjustable via knobs (CSS variables), the Inspector's 3D section, and keyframes | Change parameters → re-bake |
| Best for | Lightweight effects, titles, device mockups | Heavy materials, lighting, complex scenes |

Live 3D reads self-contained `.glb` files with no external buffers.
**Draco compression and KTX2 are not supported**; export the glb uncompressed.

## Prerequisites

- Blender installed locally (if not yet installed, bake-3d checks for it and walks you
  through setup; it never installs without your approval). Point to it with the `AKARI_BLENDER_BIN`
  environment variable if needed

Spec details: [3D Bake Recipe Contract](../contract-2026-07-14-3d-bake-recipe.md) (Japanese)
