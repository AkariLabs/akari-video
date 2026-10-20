# Set device screen and key materials during generation

When a screen looks washed out, first distinguish the acquired original, the generation recipe, and the derived GLB for live use. A black Base Color and emissive image alone do not stop PBR specular reflections. If a path replaces Emission with Principled, inspect the effective metallic, roughness, specular, and clearcoat values too.

Treat the screen, key plastic, legends, chassis, and trackpad separately. Do not lower scene-wide ambient light or exposure to fix the screen. Do not apply settings unconditionally to every material based on a name such as `ScreenMaterial`.

## Shared generation entry point

[scripts/device_materials.py](scripts/device_materials.py) applies explicitly specified material coefficients only to the JSON chunk of a GLB. It preserves the BIN chunk's images, geometry, cameras, and animations byte for byte. It also preserves `emissiveTexture`, `emissiveFactor`, emissive strength, unspecified coefficients, textures, and extensions. Do not add unsupported keys to runtime `materialOverrides`.

Calling `export_glb(filepath, profiles, **export_options)` from a Blender recipe makes normal GLB export and material settings one generation step. Load the module from this skill's `scripts/` with `importlib.util.spec_from_file_location`. In a deployed project the helper is at `.claude/skills/author-scene3d/scripts/device_materials.py`. If embedding it in a stand-alone recipe, bundle the helper with the recipe; never embed a user-specific absolute path.

Run Python 3 to transform an existing model into a derived preview asset:

```sh
python3 .claude/skills/author-scene3d/scripts/device_materials.py \
  --input assets/models/original.glb --output assets/generated/device-matte.glb \
  --profiles .akari/work/keep/device-material-profiles.json \
  --report .akari/reports/device-materials.json
```

Do not overwrite the input or an existing output. Do not create a project-specific bypass script that updates the original. Keep the chosen profiles JSON as generation-recipe input, and preserve the materials in later transformations.

Profiles are an array of explicit targets. These candidate values were checked under strong studio lighting; they are **not defaults for every device**. Each coefficient in `values` is in the range 0–1.

```json
[
  {"material":"ScreenMaterial","values":{"metallic":0,"roughness":0.90,"specular":0.05}},
  {"material":"keycap","meshes":["keyboard_keys"],"name":"KeyboardMatteMaterial",
   "values":{"roughness":0.90,"specular":0.02,"clearcoat":0}}
]
```

Specifying `meshes` duplicates the material and assigns the copy only to the target primitives of those meshes. Preserve the original keycap material shared by USB ports or other parts. Duplicate or ambiguous material / mesh names, missing targets, unknown coefficients, and values outside the range are errors. Omitting `meshes` targets every use of that material, so inspect the target list in the audit report.

## Compare and adopt

- Compare front and left/right oblique views with the same image, camera, lighting, and emissive multiplier. Make controls that change key specular, clearcoat, and roughness one at a time. Do not first darken color or exposure and hide the cause.
- Check a phone with a glass screen under the same lighting. Distinguish the emissive screen insert from the glass, bezel, and back behind it. Do not change a model that does not reproduce the washed-out look.
- Test image and video replacement and brightness retention. Confirm `KHR_materials_specular` / `KHR_materials_clearcoat` survive loading. `threeRuntime.inspect(container).materials` is the inspection entry point for loaded coefficients.
- Compare in the [existing preview](../edit-lint/preview.md) and actual GPU / OSR output. State which entry point was used to check playback, seeking, and frames. Do not describe another page's rendering as application-verified.
- Record comparison images, adopted values, asset version and hash, changed targets, and invariants for untouched targets. Visually confirm that screen black, white text, colored UI, key legends, and chassis remain distinguishable. Update a distributed original only as a verified version update; never replace an existing project's original.
