# @akari-video/generate

This dependency-free package normalizes generation slots and validates them against one model capability row.
The UI, CLI, and agent integrations should all call the same `validateInputs` function.

```js
import { validateInputs } from '@akari-video/generate';
const { ok, normalized, rounded, messages, cost } = validateInputs({ inputs, output, model });
```

Messages use `error`, `warn`, or `info` levels with stable codes such as `first_frame.required`, `duration.rounded`, and `price.unknown`.
A model without recorded pricing remains valid and returns `cost.needs_explicit_confirm` instead of changing `ok` to false.

`akari generate still <projectDir> --spec beats.json` はビートごとの静止画を Codex で生成します。
`--parallel N` で並列数を指定でき、既定は 4 です。
`--placeholder` は Codex を呼ばず、Chrome → ffmpeg drawtext → 単色の順で無料の文字カード PNG を置きます。
`--dry-run` は edit.json や素材を書かず、配置予定だけを表示します。
生成物と meta は `assets/generated/`、クリップは edit.json v2 の visual トラック末尾に入ります。
