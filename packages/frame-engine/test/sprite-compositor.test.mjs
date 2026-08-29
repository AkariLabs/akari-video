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

test("released sprite textures are removed and dispose does not delete them twice", () => {
  const deleted = [];
  const compositor = Object.create(SpriteCompositor.prototype);
  compositor.gl = {
    deleteTexture: (texture) => deleted.push(texture),
    deleteBuffer: () => {},
    deleteProgram: () => {},
  };
  compositor.baseTexture = { id: "base" };
  compositor.vertexBuffer = {};
  compositor.tileVertexBuffer = {};
  compositor.program = {};
  compositor.tileProgram = {};
  compositor.sprites = new Map([
    ["released", { id: "released" }],
    ["live", { id: "live" }],
  ]);
  compositor.disposed = false;

  compositor.releaseSprite("released");
  assert.equal(compositor.sprites.has("released"), false);
  assert.throws(() => compositor.releaseSprite("released"), /unknown sprite/u);
  compositor.dispose();
  assert.equal(deleted.filter((texture) => texture.id === "released").length, 1);
  assert.equal(deleted.filter((texture) => texture.id === "live").length, 1);
});

test("compose reuses VAOs and suppresses redundant GL state within one frame", () => {
  const calls = [];
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
    bindFramebuffer: (...args) => calls.push(["bindFramebuffer", ...args]),
    clearColor: (...args) => calls.push(["clearColor", ...args]),
    clear: (...args) => calls.push(["clear", ...args]),
    useProgram: (...args) => calls.push(["useProgram", ...args]),
    bindVertexArray: (...args) => calls.push(["bindVertexArray", ...args]),
    activeTexture: (...args) => calls.push(["activeTexture", ...args]),
    bindTexture: (...args) => calls.push(["bindTexture", ...args]),
    pixelStorei: (...args) => calls.push(["pixelStorei", ...args]),
    texImage2D: (...args) => calls.push(["texImage2D", ...args]),
    uniformMatrix3fv: (...args) => calls.push(["uniformMatrix3fv", ...args]),
    uniform1f: (...args) => calls.push(["uniform1f", ...args]),
    uniform1i: (...args) => calls.push(["uniform1i", ...args]),
    uniform4f: (...args) => calls.push(["uniform4f", ...args]),
    enable: (...args) => calls.push(["enable", ...args]),
    disable: (...args) => calls.push(["disable", ...args]),
    blendFunc: (...args) => calls.push(["blendFunc", ...args]),
    drawArrays: (...args) => calls.push(["drawArrays", ...args]),
    flush: (...args) => calls.push(["flush", ...args]),
  };
  const base = { id: "base" };
  const plain = { id: "plain" };
  const cropped = { id: "cropped" };
  const highlight = { id: "highlight" };
  const compositor = Object.create(SpriteCompositor.prototype);
  Object.assign(compositor, {
    gl,
    canvas: { width: 100, height: 100 },
    program: { id: "program" },
    vertexArray: { id: "vao" },
    tileProgram: { id: "tile-program" },
    tileVertexArray: { id: "tile-vao" },
    matrixLocation: {},
    opacityLocation: {},
    tileUnitLocation: {},
    tileTransformLocation: {},
    tileSourceLocation: {},
    tileDestinationLocation: {},
    tileMixLocation: {},
    tileOpacityLocation: {},
    tileHighlightTextureLocation: {},
    baseTexture: base,
    sprites: new Map([
      ["plain", plain],
      ["cropped", cropped],
      ["highlight", highlight],
    ]),
    disposed: false,
  });

  compositor.compose({}, [
    { id: "plain", opacity: 1 },
    { id: "plain", opacity: 1 },
    { id: "cropped", opacity: 1, textureRect: { x: 0, y: 0, width: 100, height: 100 } },
    { id: "cropped", opacity: 1, textureRect: { x: 0, y: 0, width: 100, height: 100 } },
    { id: "cropped", secondaryId: "highlight", opacity: 1, tiles: [{ x: 0, y: 0, width: 100, height: 100 }] },
    { id: "cropped", secondaryId: "highlight", opacity: 1, tiles: [{ x: 0, y: 0, width: 100, height: 100 }] },
  ]);

  const count = (name) => calls.filter(([call]) => call === name).length;
  assert.equal(count("useProgram"), 2);
  assert.equal(count("bindVertexArray"), 2);
  assert.equal(count("blendFunc"), 1);
  assert.equal(count("activeTexture"), 2);
  assert.equal(count("bindTexture"), 4);
  assert.equal(count("uniform1i"), 2);
  assert.equal(count("drawArrays"), 7);
  assert.equal(count("flush"), 1);
  assert.equal(count("bindBuffer"), 0);
  assert.equal(count("enableVertexAttribArray"), 0);
  assert.equal(count("vertexAttribPointer"), 0);
});
