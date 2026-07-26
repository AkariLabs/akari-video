**English** | [日本語](./bake-3d.ja.md)

# Bake a 3D scene

Separate from Three.js's live 3D, this is the path for **baking a 3D scene into video
footage** using Blender. The skill is `bake-3d`. It lets you drop heavy 3D expression into
`edit.json` as an ordinary clip.

## When to use

- You want a 3D opening, logo animation, or object showcase as video footage
- You want to re-bake an existing bake recipe with different parameters

## How it works — the recipe model

3D scenes are managed as "recipes" (`scene.py` plus a parameter declaration).

- A recipe is a reproducible script that runs Blender headless and bakes it to mp4
- Adjustable points such as color, text, and speed are declared as parameters, so you
  can re-bake by changing values alone, without touching Blender
- The baked output goes to `bakes/*.mp4` and is used as **an ordinary clip in edit.json**

## How to ask

- "make a 3D opening with a spinning logo"
- "change this recipe's text to 'Episode 2' and re-bake"
- "check it quickly with draft, and if it looks good, do final" (`--profile draft / final`)

## Flow

1. Pick a recipe or create a new one (search the catalog / library)
2. Confirm parameters → run the bake (Blender headless)
3. Verify the output (duration, resolution, keyframe inspection)
4. Place it in the project, or [add it to the library](./asset-library.md)

## Three.js vs. baking

| | Live 3D (overlay-authoring) | Baked (bake-3d) |
|---|---|---|
| What it is | A Three.js HTML overlay | An mp4 clip baked in Blender |
| How touchable | Instantly adjustable via knobs (CSS variables) | Change parameters → re-bake |
| Best for | Lightweight effects, titles | Heavy materials, lighting, complex scenes |

## Prerequisites

- Blender installed locally (if not yet installed, bake-3d checks for it and walks you
  through setup)

Spec details: [3D Bake Recipe Contract](../contract-2026-07-14-3d-bake-recipe.md) (Japanese)
