import assert from "node:assert/strict";
import test from "node:test";

import { extractThreeError, stripThreeErrorMarker } from "../src/electron-main.mjs";

test("extractThreeError restores the structured 3D failure from the page marker", () => {
  const threeError = { overlayId: "t1", name: "Error", message: "3D overlay fragment は単一ルートである必要があります" };
  const error = new Error(
    `3D overlay t1 failed to initialize: threeRuntime status=error: ${threeError.message}`
    + `\nAKARI_THREE_ERROR:${encodeURIComponent(JSON.stringify(threeError))}`,
  );
  assert.deepEqual(extractThreeError(error), threeError);
});

test("stripThreeErrorMarker removes only the internal marker line", () => {
  const error = new Error(
    "3D overlay t1 failed to initialize: threeRuntime status=error"
    + `\nAKARI_THREE_ERROR:${encodeURIComponent(JSON.stringify({ overlayId: "t1", message: "reason" }))}`,
  );
  assert.equal(stripThreeErrorMarker(error.message), "3D overlay t1 failed to initialize: threeRuntime status=error");
});

test("stripThreeErrorMarker keeps the following section separated", () => {
  const source = "3D overlay t1 failed to initialize: threeRuntime status=error"
    + `\nAKARI_THREE_ERROR:${encodeURIComponent(JSON.stringify({ overlayId: "t1", message: "reason" }))}`
    + "\nrecent warnings:\n- one";
  assert.equal(
    stripThreeErrorMarker(source),
    "3D overlay t1 failed to initialize: threeRuntime status=error\nrecent warnings:\n- one",
  );
});

test("extractThreeError returns null when the marker is absent", () => {
  assert.equal(extractThreeError(new Error("plain failure")), null);
});
