import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const runtimePath = resolve(import.meta.dirname, "../src/world-runtime.js");
const schemaPath = resolve(import.meta.dirname, "../../schemas/world-map.schema.json");
const examplePath = resolve(import.meta.dirname, "../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const map = JSON.parse(readFileSync(examplePath, "utf8"));
const context = vm.createContext({ window: {} });
vm.runInContext(readFileSync(runtimePath, "utf8"), context);

const descriptor = {
  schemaVersion: 1,
  kind: "flat",
  frame: { width: 320, height: 180 },
  worlds: map.worlds,
  zones: map.zones,
  cameraStops: map.cameraStops,
  edges: map.edges,
  retainedNodes: map.retainedNodes,
};
const clone = value => JSON.parse(JSON.stringify(value));
const container = value => ({
  querySelector: () => ({ textContent: JSON.stringify(value) }),
});
const harmlessValues = {
  worlds: {
    id: "world", label: "World", palette: { background: "#000000", dots: "#111111", accent: "#ffffff" },
    flat: { bounds: [0, 0, 100, 100], pattern: "none" }, spatial: { c: [0, 0, 0] },
  },
  zones: { id: "zone", label: "Zone", world: "atelier", c: [0, 0] },
  cameraStops: {
    id: "stop", label: "Stop", world: "atelier", at: 0, leave: 1, c: [0, 0, 1], eye: [0, 0, 1], target: [0, 0, 0],
  },
  edges: {
    id: "edge", from: "stop-a", to: "stop-b", type: "move", t0: 0, t1: 1, switchTime: 0.5,
    transition: { kind: "none", cover: 0 }, via: "zone", carry: ["node"], easing: "linear",
  },
};
const collections = ["worlds", "zones", "cameraStops", "edges"];

test("world-map collection keys are accepted by the runtime descriptor", () => {
  for (const collection of collections) {
    const schemaKeys = Object.keys(schema.properties[collection].items.properties);
    const valueKeys = Object.keys(harmlessValues[collection]);
    for (const key of schemaKeys) {
      assert.ok(Object.hasOwn(harmlessValues[collection], key), `harmlessValues に ${collection}[].${key} の値がありません`);
    }
    for (const key of valueKeys) {
      assert.ok(schemaKeys.includes(key), `schema にない ${collection}[].${key} が harmlessValues にあります`);
    }
    for (const key of schemaKeys) {
      const value = clone(descriptor);
      value[collection][0][key] = harmlessValues[collection][key];
      try {
        context.window.akari.worldRuntime.readDescriptor(container(value));
      } catch (error) {
        assert.doesNotMatch(error.message, /は未知のキーです/u, `${collection}[].${key}`);
      }
    }
  }
});

test("unknown collection keys remain TypeError failures", () => {
  for (const collection of collections) {
    const value = clone(descriptor);
    value[collection][0].__drift__ = true;
    assert.throws(
      () => context.window.akari.worldRuntime.readDescriptor(container(value)),
      error => error?.name === "TypeError" && /は未知のキーです/u.test(error.message),
      collection,
    );
  }
});

test("accepted descriptor metadata keeps its lightweight type checks", () => {
  const cases = [
    ["worlds", "spatial", []],
    ["cameraStops", "label", 1],
    ["cameraStops", "eye", [0, 0]],
    ["cameraStops", "target", "origin"],
  ];
  for (const [collection, key, injected] of cases) {
    const value = clone(descriptor);
    value[collection][0][key] = injected;
    assert.throws(
      () => context.window.akari.worldRuntime.readDescriptor(container(value)),
      error => error?.name === "TypeError" && !/は未知のキーです/u.test(error.message),
      `${collection}[].${key}`,
    );
  }
});
