import assert from "node:assert/strict";
import test from "node:test";

import {
  updateCutOpacityInSource,
  updateCutTransformInSource,
} from "../lib/common/edit-store.js";

const source = `{
  "cuts": [
    { "in": 0, "out": 2 },
    { "in": 2, "out": 4, "transform": { "x": 5, "rotate": 10 }, "opacity": 0.8 }
  ],
  "overlays": []
}
`;

test("cut transform text surgery creates only the requested known key and preserves surrounding text", () => {
  const updated = updateCutTransformInSource(source, 0, { y: -12 });
  const parsed = JSON.parse(updated);
  assert.deepEqual(parsed.cuts[0].transform, { y: -12 });
  assert.deepEqual(parsed.cuts[1].transform, { x: 5, rotate: 10 });
  assert.ok(updated.endsWith('  "overlays": []\n}\n'));
});

test("cut transform and opacity update/remove paths keep partial objects valid", () => {
  let updated = updateCutTransformInSource(source, 1, { x: null, scale: 1.25 });
  updated = updateCutOpacityInSource(updated, 1, 0.5);
  let parsed = JSON.parse(updated);
  assert.deepEqual(parsed.cuts[1].transform, { rotate: 10, scale: 1.25 });
  assert.equal(parsed.cuts[1].opacity, 0.5);

  updated = updateCutOpacityInSource(updated, 1, null);
  updated = updateCutTransformInSource(updated, 1, { rotate: null, scale: null });
  parsed = JSON.parse(updated);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.cuts[1], "opacity"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.cuts[1], "transform"), false);
});

test("cut transform write rejects schema-invalid scale and opacity values", () => {
  assert.throws(() => updateCutTransformInSource(source, 0, { scale: 0 }), /正の数/u);
  assert.throws(() => updateCutOpacityInSource(source, 0, 1.1), /0〜1/u);
});
