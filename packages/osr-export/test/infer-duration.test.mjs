import assert from "node:assert/strict";
import test from "node:test";

import * as mod from "../src/page-build-shared.mjs";

test("inferDuration returns fixed values for ordinary cuts", () => {
  const cases = [
    { name: "cuts absent", edit: {}, expected: 0 },
    { name: "empty cuts", edit: { cuts: [] }, expected: 0 },
    {
      name: "three cuts with speed, freeze, and transition",
      edit: {
        cuts: [
          { in: 0, out: 8, speed: 2, freeze: { duration_sec: 2 }, transition_out: { duration: 1 } }, // 4 + 2 - 1 = 5
          { in: 1, out: 5, freeze: { duration_sec: 1 }, transition_out: { duration: 1 } }, // 4 + 1 - 1 = 4
          { in: 0, out: 6, speed: 2, transition_out: { duration: 1 } }, // 3 - 1 = 2
        ],
      },
      expected: 11,
    },
    { name: "zero speed falls back to one", edit: { cuts: [{ in: 0, out: 4, speed: 0 }] }, expected: 4 },
    { name: "non-numeric speed falls back to one", edit: { cuts: [{ in: 0, out: 3, speed: "x" }] }, expected: 3 },
    { name: "negative span is clamped to zero", edit: { cuts: [{ in: 5, out: 2 }] }, expected: 0 },
  ];

  for (const { name, edit, expected } of cases) {
    assert.equal(mod.inferDuration(edit), expected, name);
  }
});

test("inferDuration skips sparse cuts and inferDurationGpu is not exported", () => {
  const cuts = [{ in: 0, out: 2 }, , { in: 0, out: 3 }];
  assert.equal(mod.inferDuration({ cuts }), 5);
  assert.equal(mod.inferDurationGpu, undefined);
});
