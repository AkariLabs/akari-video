**English** | [日本語](./README.ja.md)

# render-cut

`@akari-video/render-cut` turns an approved AKARI Video `edit.json` into a verified deliverable.

```sh
render-cut /path/to/project --engine osr
```

## Project input paths

Declared input paths must stay inside the project after symbolic links are resolved. A symlink is
accepted when its resolved target is a regular file inside the real project root. A symlink that
resolves outside the project is rejected; use the declared asset-library fallback when an external
library asset is intended.

## Default output name

Without `--out`, render-cut writes to `exports/` and chooses the stem in this order:

1. `edit.name`, when it is a non-empty string
2. the project directory name
3. `render`

The stem is sanitized for use as a file name. Existing outputs are not overwritten: the next name
uses `-2`, then `-3`, and so on. An explicit `--out` remains unchanged, and an output path is never
allowed to replace a declared input.

