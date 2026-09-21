# Reference-to-video OpenAPI fixtures

Retrieved on 2026-09-22 by the task wrapper via GET from each catalog source_url. Copied byte-for-byte; tests read these files offline.

- File: `bytedance_seedance-2.0_reference-to-video.json`
  - Retrieved: 2026-09-22
  - URL: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedance-2.0/reference-to-video
  - SHA-256: `7ea18e4b80cbcabdb015f43c1ce83bce6ddcb7e1868f0a93d863169ddcea24dd`

- File: `minimax_h3_reference-to-video.json`
  - Retrieved: 2026-09-22
  - URL: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/reference-to-video
  - SHA-256: `e4daee0d35bfa8f8e486efaccec463898896dc245a11ed3d9c1bb880215b22f3`

H3 reference-to-video is BLOCKED: its OpenAPI uses `Image 1`, `Video 1`, `Audio 1`, while the catalog declares `@Image`, `@Video`, `@Audio`. The fixture is retained as evidence; no H3 reference adapter is registered.
