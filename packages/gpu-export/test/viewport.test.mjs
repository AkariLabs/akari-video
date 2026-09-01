import assert from "node:assert/strict";
import test from "node:test";

import {
  deviceEmulationParameters,
  planViewport,
  verifyViewport,
  viewportMatches,
  viewportRecord,
} from "../src/electron-main.mjs";
import { buildGpuReceipt } from "../src/receipt.mjs";

const requested = { width: 3840, height: 2160 };
const display = { width: 1920, height: 1080 };

test("viewport that already matches the requested output needs no device emulation", () => {
  const measured = { width: 3840, height: 2160, devicePixelRatio: 1 };
  assert.equal(viewportMatches(requested, measured), true);
  assert.deepEqual(planViewport({ requested, measured }), { emulate: false, parameters: null });
  assert.deepEqual(verifyViewport({ requested, measured, emulated: false, display }), {
    requested: { width: 3840, height: 2160 },
    measured: { width: 3840, height: 2160 },
    emulated: false,
    display: { width: 1920, height: 1080 },
  });
  assert.deepEqual(planViewport({
    requested: { width: 1280, height: 720 },
    measured: { width: 1280, height: 720, devicePixelRatio: 1 },
  }), { emulate: false, parameters: null });
});

test("viewport clamped by the physical display plans device emulation at the requested size", () => {
  // Measured on a 1920x1080 display when 3840x2160 was requested (issue #40 §1).
  const measured = { width: 1904, height: 993, devicePixelRatio: 1 };
  assert.equal(viewportMatches(requested, measured), false);
  const plan = planViewport({ requested, measured });
  assert.equal(plan.emulate, true);
  assert.deepEqual(plan.parameters, deviceEmulationParameters(requested));
  assert.deepEqual(plan.parameters, {
    screenPosition: "desktop",
    screenSize: { width: 3840, height: 2160 },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width: 3840, height: 2160 },
    deviceScaleFactor: 1,
    scale: 1,
  });
  const record = verifyViewport({
    requested,
    measured: { width: 3840, height: 2160, devicePixelRatio: 1 },
    emulated: true,
    display,
  });
  assert.deepEqual(record, {
    requested: { width: 3840, height: 2160 },
    measured: { width: 3840, height: 2160 },
    emulated: true,
    display: { width: 1920, height: 1080 },
  });
});

test("viewport that still mismatches after emulation fails closed with requested / measured / display", () => {
  const measured = { width: 1904, height: 993, devicePixelRatio: 1 };
  assert.throws(
    () => verifyViewport({ requested, measured, emulated: true, display }),
    (error) => {
      assert.match(error.message, /GPU viewport mismatch after device emulation/u);
      assert.match(error.message, /requested 3840x2160/u);
      assert.match(error.message, /measured 1904x993/u);
      assert.match(error.message, /primary display 1920x1080/u);
      assert.deepEqual(error.viewport, {
        requested: { width: 3840, height: 2160 },
        measured: { width: 1904, height: 993 },
        emulated: true,
        display: { width: 1920, height: 1080 },
      });
      return true;
    },
  );
  assert.throws(
    () => verifyViewport({ requested, measured, emulated: false, display }),
    /^Error: GPU viewport mismatch: requested 3840x2160/u,
  );
});

test("viewport with devicePixelRatio other than 1 is a mismatch even at the requested size", () => {
  const measured = { width: 3840, height: 2160, devicePixelRatio: 2 };
  assert.equal(viewportMatches(requested, measured), false);
  assert.equal(planViewport({ requested, measured }).emulate, true);
  assert.equal(planViewport({ requested, measured }).parameters.deviceScaleFactor, 1);
  assert.throws(
    () => verifyViewport({ requested, measured, emulated: true, display }),
    /requested 3840x2160 \(devicePixelRatio 1\), measured 3840x2160 \(devicePixelRatio 2\)/u,
  );
});

test("viewport record and GPU receipt carry requested / measured / emulated / display", () => {
  const viewport = viewportRecord({
    requested,
    measured: { width: 3840, height: 2160, devicePixelRatio: 1 },
    emulated: true,
    display,
  });
  const receipt = buildGpuReceipt({ tier: 2, run: { status: "completed", viewport } });
  assert.deepEqual(receipt.gpu.viewport, {
    requested: { width: 3840, height: 2160 },
    measured: { width: 3840, height: 2160 },
    emulated: true,
    display: { width: 1920, height: 1080 },
  });
  assert.equal(buildGpuReceipt({ tier: 2, run: { status: "completed" } }).gpu.viewport, null);
  assert.equal(buildGpuReceipt({ tier: 2, run: { viewport: { requested, measured: null, emulated: "yes", display } } }).gpu.viewport, null);
});
