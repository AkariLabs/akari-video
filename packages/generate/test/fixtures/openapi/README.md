# Reference-to-video OpenAPI fixtures

The canonical documents are in `packages/schemas/fixtures/gen-models/openapi/`,
where catalog drift tests already read them. Generate adapter tests read those
files directly using relative URLs from each test module. This directory keeps
only the retrieval record below, avoiding independently maintained copies of the
same endpoint schema and supporting Windows checkouts.

The task wrapper retrieved the originals via GET from each catalog source_url on
2026-09-22. No generation requests were made. Before consolidation, the existing
`packages/schemas/bin/refresh-gen-models-openapi.mjs` sanitizer was applied offline:
remove examples, externalDocs and thumbnails; replace non-server URLs. Existing
canonical key order is retained. Consequently the canonical files are not
byte-for-byte copies of the retrieved originals, and their hashes differ.

| Original retrieved filename | Canonical filename | Original SHA-256 (before sanitizing) |
| --- | --- | --- |
| `bytedance_seedance-2.0_reference-to-video.json` | `fal_seedance-2.0-ref.json` | `7ea18e4b80cbcabdb015f43c1ce83bce6ddcb7e1868f0a93d863169ddcea24dd` |
| `minimax_h3_reference-to-video.json` | `fal_h3-ref.json` | `e4daee0d35bfa8f8e486efaccec463898896dc245a11ed3d9c1bb880215b22f3` |

Sources:

- Seedance: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance/seedance-2.0/reference-to-video
- H3: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax/h3/reference-to-video

H3 uses `Image 1`, `Video 1`, `Audio 1`. The catalog and registered H3 adapter now
use that notation. The newer H3 source also permits audio-only references and
mentions `disabled` prompt expansion; these descriptions update the canonical
snapshot. Seedance's canonical content remains unchanged.
