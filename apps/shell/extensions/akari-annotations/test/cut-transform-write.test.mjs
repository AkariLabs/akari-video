import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  setCutTransitionOutInSource,
  updateCutOpacityInSource,
  updateCutTransformInSource,
} from "../lib/common/edit-store.js";

const { TRANSITION_TYPE_IDS } = createRequire(import.meta.url)(
  "../../../../../packages/edit-store/lib/index.js"
);

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

test("setCutTransitionOutInSource appends transition_out when absent and leaves other cuts untouched", () => {
  const updated = setCutTransitionOutInSource(source, 0, { type: "dissolve", duration: 0.5 });
  const parsed = JSON.parse(updated);
  assert.deepEqual(parsed.cuts[0].transition_out, { type: "dissolve", duration: 0.5 });
  assert.deepEqual(parsed.cuts[1], { in: 2, out: 4, transform: { x: 5, rotate: 10 }, opacity: 0.8 });
  assert.ok(updated.endsWith('  "overlays": []\n}\n'));
});

test("setCutTransitionOutInSource replaces an existing transition_out wholesale", () => {
  const withTransition = setCutTransitionOutInSource(source, 0, { type: "dissolve", duration: 0.5 });
  const replaced = setCutTransitionOutInSource(withTransition, 0, { type: "fade-black", duration: 1.2 });
  assert.deepEqual(JSON.parse(replaced).cuts[0].transition_out, { type: "fade-black", duration: 1.2 });
});

test("setCutTransitionOutInSource accepts all canonical transition types", () => {
  for (const type of TRANSITION_TYPE_IDS) {
    const updated = setCutTransitionOutInSource(source, 0, { type, duration: 0.75 });
    assert.deepEqual(JSON.parse(updated).cuts[0].transition_out, { type, duration: 0.75 });
  }
});

test("setCutTransitionOutInSource with null removes the property entirely (undo back to absent)", () => {
  const withTransition = setCutTransitionOutInSource(source, 0, { type: "fade-white", duration: 0.3 });
  const removed = setCutTransitionOutInSource(withTransition, 0, null);
  assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(removed).cuts[0], "transition_out"), false);
  // Removing when already absent is a no-op (byte-identical for that cut).
  assert.equal(setCutTransitionOutInSource(source, 0, null), source);
});

test("setCutTransitionOutInSource rejects invalid type/duration", () => {
  assert.throws(() => setCutTransitionOutInSource(source, 0, { type: "dissolve", duration: 0 }), /正の数/u);
  assert.throws(() => setCutTransitionOutInSource(source, 0, { type: "wipe", duration: 0.5 }), /種別/u);
});

test("setCutTransitionOutInSource replaces an existing explicit null (real dogfood-data shape, not merely absent)", () => {
  const withExplicitNull = `{
  "cuts": [
    { "in": 0, "out": 2, "transition_out": null, "transform": { "x": 0 } }
  ],
  "overlays": []
}
`;
  const updated = setCutTransitionOutInSource(withExplicitNull, 0, { type: "fade-white", duration: 0.4 });
  const parsed = JSON.parse(updated);
  assert.deepEqual(parsed.cuts[0].transition_out, { type: "fade-white", duration: 0.4 });
  assert.deepEqual(parsed.cuts[0].transform, { x: 0 });
});
