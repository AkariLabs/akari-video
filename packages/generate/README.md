# @akari-video/generate

This dependency-free package normalizes generation slots and validates them against one model capability row.
The UI, CLI, and agent integrations should all call the same `validateInputs` function.

```js
import { validateInputs } from '@akari-video/generate';
const { ok, normalized, rounded, messages, cost } = validateInputs({ inputs, output, model });
```

Messages use `error`, `warn`, or `info` levels with stable codes such as `first_frame.required`, `duration.rounded`, and `price.unknown`.
A model without recorded pricing remains valid and returns `cost.needs_explicit_confirm` instead of changing `ok` to false.
