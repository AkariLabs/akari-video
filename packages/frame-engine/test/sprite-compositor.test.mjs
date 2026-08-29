import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSpriteDraw,
  normalizeSpriteTextureRect,
  normalizeSpriteTile,
  SpriteCompositor,
  spriteTileSourceRect,
  spriteTileMatrix,
  spriteTransformMatrix,
} from "../dist/exits/sprite-compositor.js";

test("sprite draw defaults and clamps opacity", () => {
  assert.deepEqual(normalizeSpriteDraw({ id: "caption", opacity: 2 }), {
    id: "caption", opacity: 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotateDeg: 0,
  });
});

test("sprite transform maps pixels to clip space and flips y translation", () => {
  const value = [...spriteTransformMatrix({ id: "x", opacity: 1, translateX: 10, translateY: 20 }, 100, 200)];
  assert.ok(Math.abs(value[6] - 0.2) < 1e-6);
  assert.ok(Math.abs(value[7] + 0.2) < 1e-6);
});

test("sprite helpers reject invalid input", () => {
  assert.throws(() => normalizeSpriteDraw({ id: "", opacity: 1 }), /non-empty/);
  assert.throws(() => spriteTransformMatrix({ id: "x", opacity: 1 }, 0, 1), /positive/);
});

test("an integer tile with identity transform preserves one-to-one pixel placement", () => {
  const tile = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(normalizeSpriteTile(tile), {
    ...tile,
    mix: 0,
    visible: true,
    opacity: 1,
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotateDeg: 0,
  });
  assert.ok([...spriteTileMatrix(tile, 100, 200)]
    .every((value, index) => Math.abs(value - [1, 0, 0, 0, 1, 0, 0, 0, 1][index]) < 1e-12));
});

test("tile transform keeps scale centered on the tile", () => {
  const matrix = [...spriteTileMatrix({ x: 10, y: 20, width: 30, height: 40, scaleX: 2, scaleY: 2 }, 100, 200)];
  const centerX = (25 * 2 / 100) - 1;
  const centerY = 1 - (40 * 2 / 200);
  assert.ok(Math.abs((matrix[0] * centerX + matrix[3] * centerY + matrix[6]) - centerX) < 1e-6);
  assert.ok(Math.abs((matrix[1] * centerX + matrix[4] * centerY + matrix[7]) - centerY) < 1e-6);
});

test("cropped texture coordinates are relative to textureRect", () => {
  assert.deepEqual(normalizeSpriteTextureRect(undefined, 1920, 1080), {
    x: 0, y: 0, width: 1920, height: 1080,
  });
  const source = [...spriteTileSourceRect(
    { x: 100, y: 420, width: 200, height: 40 },
    { x: 0, y: 400, width: 1920, height: 160 },
    1920,
    1080,
  )];
  assert.ok(Math.abs(source[0] - 100 / 1920) < 1e-7);
  assert.ok(Math.abs(source[1] - 20 / 160) < 1e-7);
  assert.ok(Math.abs(source[2] - 200 / 1920) < 1e-7);
  assert.ok(Math.abs(source[3] - 40 / 160) < 1e-7);
});

function mockCompositor(spriteIds, textureUnitCount = 6) {
  const calls = [];
  const uploads = [];
  const draws = [];
  const deleted = [];
  const bindings = Array(textureUnitCount).fill(null);
  let activeUnit = 0;
  let instanceOffset = 0;
  let currentProgram = null;
  let currentArrayBuffer = null;
  const gl = {
    FRAMEBUFFER: 1,
    COLOR_BUFFER_BIT: 2,
    TEXTURE0: 100,
    TEXTURE_2D: 101,
    UNPACK_FLIP_Y_WEBGL: 102,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 103,
    RGBA: 104,
    UNSIGNED_BYTE: 105,
    BLEND: 106,
    SRC_ALPHA: 107,
    ONE_MINUS_SRC_ALPHA: 108,
    TRIANGLE_STRIP: 109,
    ARRAY_BUFFER: 110,
    DYNAMIC_DRAW: 111,
    FLOAT: 112,
    bindFramebuffer: (...args) => calls.push(["bindFramebuffer", ...args]),
    clearColor: (...args) => calls.push(["clearColor", ...args]),
    clear: (...args) => calls.push(["clear", ...args]),
    useProgram: (...args) => {
      currentProgram = args[0];
      calls.push(["useProgram", ...args]);
    },
    bindVertexArray: (...args) => calls.push(["bindVertexArray", ...args]),
    activeTexture: (value) => {
      activeUnit = value - 100;
      calls.push(["activeTexture", value]);
    },
    bindTexture: (...args) => {
      bindings[activeUnit] = args[1];
      calls.push(["bindTexture", ...args]);
    },
    pixelStorei: (...args) => calls.push(["pixelStorei", ...args]),
    texImage2D: (...args) => calls.push(["texImage2D", ...args]),
    uniformMatrix3fv: (...args) => calls.push(["uniformMatrix3fv", ...args]),
    uniform1f: (...args) => calls.push(["uniform1f", ...args]),
    uniform2f: (...args) => calls.push(["uniform2f", ...args]),
    enable: (...args) => calls.push(["enable", ...args]),
    disable: (...args) => calls.push(["disable", ...args]),
    blendFunc: (...args) => calls.push(["blendFunc", ...args]),
    bindBuffer: (...args) => {
      if (args[0] === 110) currentArrayBuffer = args[1];
      calls.push(["bindBuffer", ...args]);
    },
    bufferData: (...args) => calls.push(["bufferData", ...args]),
    bufferSubData: (target, offset, data) => {
      uploads.push({ buffer: currentArrayBuffer, data: new Float32Array(data) });
      calls.push(["bufferSubData", target, offset, data.length]);
    },
    vertexAttribPointer: (...args) => {
      if (args[0] === 1) instanceOffset = args[5];
      calls.push(["vertexAttribPointer", ...args]);
    },
    drawArrays: (...args) => calls.push(["drawArrays", ...args]),
    drawArraysInstanced: (...args) => {
      draws.push({
        offset: instanceOffset,
        count: args[3],
        bindings: [...bindings],
        program: currentProgram,
      });
      calls.push(["drawArraysInstanced", ...args]);
    },
    flush: (...args) => calls.push(["flush", ...args]),
    deleteTexture: (texture) => deleted.push(texture),
    deleteVertexArray: (...args) => calls.push(["deleteVertexArray", ...args]),
    deleteBuffer: (...args) => calls.push(["deleteBuffer", ...args]),
    deleteProgram: (...args) => calls.push(["deleteProgram", ...args]),
  };
  const baseTexture = { id: "base" };
  const sprites = new Map(spriteIds.map((id) => [id, { id }]));
  const compositor = Object.create(SpriteCompositor.prototype);
  Object.assign(compositor, {
    gl,
    canvas: { width: 100, height: 100 },
    program: { id: "program" },
    vertexArray: { id: "vao" },
    matrixLocation: { id: "matrix" },
    opacityLocation: { id: "opacity" },
    instanceProgram: { id: "instance-program" },
    instanceVertexArray: { id: "instance-vao" },
    instanceBuffer: { id: "instance-buffer" },
    instanceCanvasLocation: { id: "canvas" },
    plainInstanceProgram: { id: "plain-instance-program" },
    plainInstanceVertexArray: { id: "plain-instance-vao" },
    plainInstanceBuffer: { id: "plain-instance-buffer" },
    vertexBuffer: { id: "vertex-buffer" },
    textureUnitCount,
    instanceCapacity: 1,
    instanceData: new Float32Array(30),
    plainInstanceCapacity: 1,
    plainInstanceData: new Float32Array(11),
    baseTexture,
    sprites,
    probe: null,
    disposed: false,
  });
  return { compositor, calls, uploads, draws, deleted, sprites };
}

test("released sprite textures are removed and dispose does not delete them twice", () => {
  const value = mockCompositor(["released", "live"]);

  value.compositor.releaseSprite("released");
  assert.equal(value.compositor.sprites.has("released"), false);
  assert.throws(() => value.compositor.releaseSprite("released"), /unknown sprite/u);
  value.compositor.dispose();
  assert.equal(value.deleted.filter((texture) => texture.id === "released").length, 1);
  assert.equal(value.deleted.filter((texture) => texture.id === "live").length, 1);
});

test("compose batches three caption units and rebuilds texture binds each frame", () => {
  const ids = ["a", "a-hi", "b", "b-hi", "c", "c-hi"];
  const value = mockCompositor(ids);
  const draws = ["a", "b", "c"].map((id) => ({
    id,
    secondaryId: `${id}-hi`,
    opacity: 1,
    tiles: [{ x: 0, y: 0, width: 100, height: 100 }],
  }));
  const labels = [];
  const shapes = [];
  value.compositor.setDrawProbe({
    section(label, run) {
      labels.push(label);
      run();
    },
    frame(shape) {
      shapes.push(shape);
    },
  });
  value.compositor.compose({}, draws);

  const count = (name) => value.calls.filter(([call]) => call === name).length;
  assert.equal(count("drawArrays"), 1);
  assert.equal(count("drawArraysInstanced"), 1);
  assert.deepEqual(value.draws.map((draw) => draw.count), [3]);
  assert.deepEqual(shapes, [{ plainDraws: 1, tileDraws: 3, tiles: 3 }]);
  assert.equal(labels.filter((label) => label === "instanceUpload").length, 1);
  assert.equal(labels.filter((label) => label === "drawArrays").length, 2);

  value.calls.length = 0;
  value.compositor.setDrawProbe(null);
  value.compositor.compose({}, draws);
  assert.equal(value.calls.filter(([call]) => call === "bindTexture").length, 7);
  assert.equal(value.calls.filter(([call]) => call === "drawArraysInstanced").length, 1);
});

test("draw probing preserves the batched GL call sequence", () => {
  const ids = ["caption", "highlight"];
  const draw = [{
    id: "caption",
    secondaryId: "highlight",
    opacity: 0.75,
    tiles: [{ x: 10, y: 20, width: 30, height: 40, mix: 0.5 }],
  }];
  const plain = mockCompositor(ids);
  const probed = mockCompositor(ids);
  const labels = [];
  probed.compositor.setDrawProbe({
    section(label, run) {
      labels.push(label);
      run();
    },
    frame() {},
  });
  plain.compositor.compose({}, draw);
  probed.compositor.compose({}, draw);

  assert.deepEqual(probed.calls, plain.calls);
  assert.deepEqual(probed.uploads, plain.uploads);
  assert.ok(labels.includes("instanceUpload"));
  assert.equal(labels.filter((label) => label === "drawArrays").length, 2);
});

test("plain and tile draws split into ordered runs without changing array order", () => {
  const value = mockCompositor(["plain-a", "tile-b", "plain-c", "tile-d", "tile-d-hi"]);
  value.compositor.compose({}, [
    { id: "plain-a", opacity: 1 },
    { id: "tile-b", opacity: 1, textureRect: { x: 0, y: 0, width: 100, height: 100 } },
    { id: "plain-c", opacity: 1 },
    {
      id: "tile-d",
      secondaryId: "tile-d-hi",
      opacity: 1,
      tiles: [{ x: 0, y: 0, width: 100, height: 100 }],
    },
  ]);

  assert.deepEqual(value.draws.map((draw) => draw.program.id), [
    "plain-instance-program",
    "instance-program",
    "plain-instance-program",
    "instance-program",
  ]);
  assert.deepEqual(value.draws.map((draw) => draw.count), [1, 1, 1, 1]);
  const tileData = value.uploads.find((entry) => entry.buffer.id === "instance-buffer").data;
  const plainData = value.uploads.find((entry) => entry.buffer.id === "plain-instance-buffer").data;
  const order = value.draws.map((draw) => {
    const plain = draw.program.id === "plain-instance-program";
    const stride = plain ? 11 : 30;
    const parameterOffset = plain ? 10 : 28;
    const data = plain ? plainData : tileData;
    const index = draw.offset / (stride * 4);
    const unit = data[index * stride + parameterOffset];
    return draw.bindings[unit].id;
  });
  assert.deepEqual(order, ["plain-a", "tile-b", "plain-c", "tile-d"]);
});

test("plain draw attributes preserve the original transform and opacity inputs", () => {
  const value = mockCompositor(["three"]);
  const draw = {
    id: "three",
    opacity: 0.625,
    translateX: 7,
    translateY: -4,
    scaleX: 1.2,
    scaleY: 0.8,
    rotateDeg: 12,
  };
  value.compositor.compose({}, [draw]);

  assert.deepEqual(value.draws.map((entry) => entry.program.id), ["plain-instance-program"]);
  const data = value.uploads.find((entry) => entry.buffer.id === "plain-instance-buffer").data;
  assert.deepEqual([...data.slice(0, 9)], [...spriteTransformMatrix(draw, 100, 100)]);
  assert.deepEqual([...data.slice(9, 11)], [...new Float32Array([0.625, 1])]);
});

test("instance attributes match the existing pure functions and omit invisible tiles", () => {
  const value = mockCompositor(["caption", "highlight"]);
  const draw = {
    id: "caption",
    secondaryId: "highlight",
    opacity: 0.8,
    translateX: 3,
    translateY: 4,
    scaleX: 1.1,
    scaleY: 0.9,
    rotateDeg: 5,
    textureRect: { x: 0, y: 40, width: 100, height: 30 },
    tiles: [
      { x: 1, y: 41, width: 5, height: 5, visible: false },
      { x: 10, y: 50, width: 20, height: 10, mix: 0.25, opacity: 0.5, translateX: 2, scaleX: 1.2 },
    ],
  };
  value.compositor.compose({}, [draw]);

  assert.deepEqual(value.draws.map((entry) => entry.count), [1]);
  const data = value.uploads.at(-1).data;
  const visible = draw.tiles[1];
  assert.deepEqual([...data.slice(0, 4)], [...spriteTileSourceRect(visible, draw.textureRect, 100, 100)]);
  assert.deepEqual([...data.slice(4, 8)], [visible.x, visible.y, visible.width, visible.height]);
  assert.deepEqual([...data.slice(8, 17)], [...spriteTransformMatrix(draw, 100, 100)]);
  assert.deepEqual([...data.slice(17, 26)], [...spriteTileMatrix(visible, 100, 100)]);
  assert.deepEqual([...data.slice(26, 30)], [...new Float32Array([0.25, 0.4, 1, 2])]);
});

test("N plus one textures split into ordered chunks without reordering instances", () => {
  const ids = ["one", "two", "three", "four"];
  const value = mockCompositor(ids, 3);
  value.compositor.compose({}, ids.map((id) => ({ id, opacity: 1 })));

  assert.deepEqual(value.draws.map((draw) => draw.count), [3, 1]);
  assert.deepEqual(value.draws.map((draw) => draw.offset), [0, 3 * 11 * 4]);
  assert.ok(value.draws.every((draw) => draw.program.id === "plain-instance-program"));
  assert.equal(value.calls.filter(([call]) => call === "drawArrays").length, 1);
  assert.equal(value.calls.filter(([call]) => call === "drawArraysInstanced").length, 2);
  const data = value.uploads.at(-1).data;
  const order = value.draws.flatMap((chunk) => {
    const start = chunk.offset / (11 * 4);
    return Array.from({ length: chunk.count }, (_, index) => {
      const unit = data[(start + index) * 11 + 10];
      return chunk.bindings[unit].id;
    });
  });
  assert.deepEqual(order, ids);
});
