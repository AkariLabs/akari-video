**English** | [日本語](./README.ja.md)

# @akari-video/template-render

Render an AKARI Video template into a video — with your own text, colors and size.

```sh
npx @akari-video/template-render ./chalkboard-jp --out my-board.mp4
```

The tool is MIT licensed. Template assets carry their own license — check each template's
`meta.json`.

## What you need

- **Node.js 20.11+**
- **Google Chrome** (or Chromium / Edge / Brave). Found automatically in the usual install
  locations; otherwise pass `--chrome /path/to/chrome`
- **ffmpeg** — only for video output. Not needed with `--png-sequence`

## See what you can change

Every template declares its knobs. Ask it:

```sh
npx @akari-video/template-render ./chalkboard-jp --list-knobs
```

```
日本の緑黒板 — 変えられるツマミ 23 個

  [layout]
    --var board-width            黒板の幅  320〜3840px
    --var frame-thickness        木枠の太さ（短辺比。0 で枠なし）  0〜8
    ...
```

## Change it

```sh
npx @akari-video/template-render ./chalkboard-jp \
  --out vertical.mp4 --size 1080x1920 --duration 5 \
  --var board-width=940 --var board-height=1200 \
  --var board-color=#1c1f1e --var frame-thickness=0 --var show-tray=0 \
  --text "今日のポイント=Today's takeaways"
```

- **Units come from the declaration.** `--var board-width=940` becomes `940px` because the
  template says that knob is in `px`. Ratio knobs are unitless — pass the bare number
- **`--text old=new`** swaps the sample copy. For bigger rewrites, edit `fragment.html`
  directly — it is plain HTML
- Unknown knob names are rejected with a pointer to `--list-knobs`

## Outputs

| Flag | Result | Use for |
|---|---|---|
| `--out demo.mp4` | H.264 / yuv420p | Sharing, social, previews |
| `--alpha out.mov` | ProRes 4444 with alpha | Dropping into Premiere / DaVinci / Final Cut |
| `--png-sequence dir/` | Numbered PNGs (no ffmpeg needed) | Any editor, custom encoding |

Add `--under photo.jpg` to composite the template over an image — useful for templates with a
transparent screen area, where a flat backdrop tells you nothing.

## Deterministic by design

Frame times come from `frame index ÷ fps`, never from the wall clock. Animations are paused and
seeked explicitly. The same inputs always produce the same output, so re-rendering a template
after a text change gives you a clean diff rather than a slightly different take.

## Options

```
--out <file>            H.264 mp4 (default: demo.mp4)
--alpha <file>          ProRes 4444 .mov with alpha
--png-sequence <dir>    numbered PNGs
--var <name=value>      set one knob (repeatable)
--vars "<css>"          set several at once
--text <old=new>        replace sample copy (repeatable)
--list-knobs            print the knobs and exit
--duration <seconds>    default 5
--fps <n>               default 30
--size <WxH>            default 1920x1080
--backdrop <color>      default #141414
--under <image>         image behind the template
--transparent           keep the background transparent
--chrome <path>         Chrome executable (auto-detected by default)
--ffmpeg <path>         ffmpeg executable (PATH by default)
```
