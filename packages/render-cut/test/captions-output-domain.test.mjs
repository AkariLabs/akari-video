import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays } from "../src/captions.mjs";

const cuts = [
  { src: "source-a", in: 0, out: 2 },
  { src: "source-b", in: 0, out: 2 },
];

const caption = (timeDomain) => ({
  id: "c-0001",
  start: 0.5,
  end: 1.5,
  text: "境界を跨ぐ字幕",
  speaker: null,
  sourceRef: null,
  edited: true,
  src: "source-a",
  ...(timeDomain === undefined ? {} : { time_domain: timeDomain }),
});

test("legacy renderer keeps one continuous output-domain cue across C1 and C2", () => {
  const [overlay] = generateCaptionOverlays([{
    ...caption("output"),
    start: 0.5,
    end: 3.5,
  }], cuts, { sourceCount: 2 });

  assert.equal(overlay.start, 0.5);
  assert.equal(overlay.duration, 3);
  assert.equal(overlay.generatedFrom, "c-0001");
});

test("output-domain cue bypasses src matching even while its interval enters another source cut", () => {
  const [overlay] = generateCaptionOverlays([{
    ...caption("output"),
    start: 2.5,
    end: 3.5,
  }], cuts, { sourceCount: 2 });

  assert.equal(overlay.start, 2.5);
  assert.equal(overlay.duration, 1);
});

test("output-domain cue does not require provenance src in a multi-source edit", () => {
  const value = caption("output");
  delete value.src;
  const [overlay] = generateCaptionOverlays([value], cuts, { sourceCount: 2 });

  assert.equal(overlay.start, 0.5);
  assert.equal(overlay.duration, 1);
});

test("output-domain cue end is clamped to the cuts duration", () => {
  const [overlay] = generateCaptionOverlays([{
    ...caption("output"),
    start: 3,
    end: 7,
  }], cuts, { sourceCount: 2 });

  assert.equal(overlay.start, 3);
  assert.equal(overlay.duration, 1);
});

test("output-domain cue at or beyond the cuts end produces no overlay", () => {
  const overlays = generateCaptionOverlays([{
    ...caption("output"),
    start: 4,
    end: 7,
  }], cuts, { sourceCount: 2 });

  assert.deepEqual(overlays, []);
});

test("undeclared and explicit source-domain cues preserve the previous projection byte-for-byte", () => {
  const undeclared = generateCaptionOverlays([caption(undefined)], cuts, { sourceCount: 2 });
  const explicitSource = generateCaptionOverlays([caption("source")], cuts, { sourceCount: 2 });

  assert.deepEqual(explicitSource, undeclared);
  assert.equal(undeclared.length, 1);
  assert.equal(undeclared[0].start, 0.5);
  assert.equal(undeclared[0].duration, 1);
});
