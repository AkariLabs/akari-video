

# Write the timeline generator

The generator, normally `<project>/.akari/work/gen-timeline.mjs`, transforms declarations into overlay HTML and edit.json in one direction. Keep the script and its outputs under `.akari/work/`, not at the project root.

## 1. Build the beat map as the sole timing source

Generate a beat map from `declarations.json` and the audio file with `akari internal beat-sync-beatmap`:
```sh
akari internal beat-sync-beatmap <project> <track-id> [--out .akari/work/beatmap.json]
```
| Key | Contents | How to use |
|---|---|---|
| `beats[]` | Time of every beat from the first downbeat, spaced by BPM | Basis for every placement |
| `beat_intensity[]` | Peak level of each beat, from 0 to 1 | Strength of **audio-reactive motion** |
| `env30[]` | RMS envelope at 30 fps | Waveform display and playhead |
| `sections[]` / `hits[]` | Declared sections and accent hits | Assign composition sections and accent timing |

During generation, the generator checks whether section boundaries align with the beat grid. A large discrepancy calls the declaration or BPM into question.

In the generator, refer to beat numbers rather than entering times:
```js
const B = (n) => beats[n];        // 拍番号 → 秒
OV('hook', 'ov-hook.html', B(32), r3(B(64) - B(32)));   // 8 小節ぶん
S('impact-boom-big', B(32), -2);                         // ドロップ頭に一発
```


## 2. Assign the sections

The `sections` labels form the composition. **Make the drop the climax and give the bridge a quieter passage.**

| Label | Suggested treatment |
|---|---|
| `intro` / `build` | Hold back with near-silence or ticks, then build anticipation at the end with a riser. |
| `drop` | Climax: logo slam, large typography, simultaneous display of diagrams, accent flash |
| `bridge` | Give viewers room to read a key sentence or supporting information. |
| `outro` | Call to action, logo, and close. |

Use `hit_points` directly for flash or sweep timing: a person chose these points by ear, so they produce a pleasing result more reliably than automatic detection.

## 3. Generate overlays

Follow [author-overlay](../author-overlay/SKILL.md) for fragment authoring. In the generator:

- Use one function per fragment to calculate `animation-delay` from beat numbers.
- When a window starts on a beat, compute the fragment's delay as `B(n) - start` so its motion stays aligned.
- Build repeated elements with an array and map, whether there are 12 chips, 16 cards, or 39 caption variants. Do not write each one by hand.
```js
const chipCss = feats.map((_, i) =>
  `${ACT(`.rcp__c${i}`)} { animation: rcp__pop 0.36s ... ${r3(B(210 + i) - r0)}s both; }`
).join('\n    ');   // 1 拍 1 個で点灯
```


## 4. Bake audio-reactive motion

**Do not analyze audio at runtime.** Bake measured beat-map values into CSS keyframes so rendering is deterministic and safe to seek.
```js
// 全 267 拍の実測強度を 1 本の keyframes に
const stops = ['0% { opacity: 0.08; }'];
for (let n = 0; n < beats.length; n++) {
  const t = beats[n], hi = 0.12 + 0.6 * (beat_intensity[n] ?? 0.5);
  const p = (x) => r3((x / DUR) * 100);
  if (t > 0.3) stops.push(`${p(t - 0.28)}% { opacity: 0.08; }`);   // 直前で戻す
  stops.push(`${p(t)}% { opacity: ${r3(hi)}; }`);                   // 拍で光る
}
```
- This method can drive background light, an equalizer, and a waveform playhead.
- For periodic elements such as an equalizer, set `animation-duration` to the beat length (`60/BPM`) and use `infinite alternate` to keep the phase aligned.

## 5. Assemble edit.json

Write the assembled file once, at the end of the generator. Include these required checks:
```js
const missing = sfx.filter((s) => !fs.existsSync(path.join(ROOT, s.path)));
if (missing.length) throw new Error('missing sfx: ' + ...);        // 存在しない音を参照しない
overlays.sort((a, b) => rank(a) - rank(b) || a.start - b.start);   // 重なり順を明示的に
```
**Array order determines z-order.** Sort background, B-roll, 3D, diagrams and typography, then sweeps and flashes with `rank()`.

## 6. Keep the generator easy to revise

- Put color, font, and duration constants at the top; many review changes can then be made in one place.
- Make reusable functions for effects such as sweeps, flashes, and Ken Burns moves; call them for each window.
- Number outputs whose filenames could collide, such as two windows using the same image. Otherwise, the later file overwrites the earlier settings.
- Recreate **all overlays on every run**. Do not build a partial-update path.
