# HTML blend and Web UI fragment save

Neutral 320×180 / 30 fps fixture at frame 30. A static PNG and two solid-color HTML items provide the overlap. Shell images are stage-only screenshots at 2× device scale; the shell sample is PNG pixel (207,125), corresponding to output pixel (100,60). OSR images are full-size frames sampled at (100,60). All PNGs are below 3 KB.

| Mode | BEFORE shell MD5 / RGB | AFTER shell MD5 / RGB | OSR MD5 / RGB (both runs) | AFTER channel delta |
|---|---|---|---|---|
| normal | `9d128a634eef7f10eb8f90c098621f59` / 120,68,39 | `9dabf8d13002166f4a794cd59ec14e77` / 120,68,39 | `a990c0d38e731ee55f87009bd2694772` / 128,64,32 | 8,4,7 |
| screen | `9dabf8d13002166f4a794cd59ec14e77` / 120,68,39 | `3594fa42c4cd4323d16d3f217962366d` / 149,126,145 | `50fc07c3aa840955edcbb71051ea7b09` / 152,124,144 | 3,2,1 |
| add | `deec2bad0c7efabafa363161458774bc` / 120,68,39 | `48029043f011d7f0e0605ba571b573cd` / 175,147,164 | `ca2b1c3dd694ddbff0f2e187a62f2795` / 176,144,160 | 1,3,4 |

The acceptance tolerance is **8 per RGB channel**, the largest observed difference at the overlap. The shell stage is displayed at a fractional 1.0375 scale and captured at 2× device scale. BEFORE all shell overlap samples were the same. AFTER the three shell MD5s and samples differ; OSR PNGs are byte-identical between runs. OSR used npm Electron launcher tier **2**, with frame 30 stamp matched in each run. `after/osr-receipts.json` records the launcher evidence. The screen child recorded a completed run and matching stamp but stayed alive after writing; only that child PID was stopped. The other captures exited normally.

Computed style: the HTML top item was `mix-blend-mode: normal` in BEFORE; the AFTER add item was `plus-lighter`. The shared mapping assigns `normal` / `screen` / `plus-lighter` to the three modes. `#overlay-stage` had `isolation:auto`, `opacity:1`, `transform:none`, `filter:none`, `contain:none`, and `z-index:auto`. The preview stage and zoom layer have transforms, but both the lower image and HTML items share those ancestors. The measured screen/add pixels show that the item blends with the lower item.

## Web UI

`before/web-fragment.html` contains a relative CSS `url()`, relative `<img>`, compact inline style, an entity, and CRLF. The BEFORE browser edit reached PUT but got **422** because the projected HTML body was mistaken for the source file path; `before/web-fragment-saved.html` is byte-identical to the authored source. The browser's preview image URL resolved to `http://127.0.0.1:<port>/overlays/images/icon.png`; CSS was rewritten to `/overlays/images/bg.png` in the preview DOM.

AFTER, an actual double-click content edit and blur produced PUT **200**. The diff is only `A &amp; B` → `C &amp; D`; the relative references, compact style, entity spelling, and CRLF stay authored. The saved fragment has **0 lines** containing `127.0.0.1`. A changed tag structure returned **422**. The endpoint tests also cover an unchanged write, slot exclusion, numeric and nonbreaking-space entities, and rejection of a preview origin. See `observations.json` for measured values.
