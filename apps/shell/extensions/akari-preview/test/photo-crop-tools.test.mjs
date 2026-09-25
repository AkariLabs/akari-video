import test from 'node:test';
import assert from 'node:assert/strict';
import { photoCropForRatio, photoCropAfterPan, photoCropConstrainRatioAfterEdge, photoCropClipPolygon, photoCropTransformPatch, smartPhotoCrop } from '../lib/common/photo-crop-tools.js';

test('crop commit omits unchanged transform keys, including absent rotate', () => {
    assert.deepEqual(photoCropTransformPatch({ x: 0, y: 0, scale: 1 },
        { x: 12, y: 0, scale: 1, rotate: 0 }), { x: 12 });
    assert.deepEqual(photoCropTransformPatch({ x: 0, scale: 1 },
        { x: 0, scale: 1, rotate: 0 }), {});
});

test('fixed aspect uses source pixels and keeps rotated corners in the image', () => {
    const crop = photoCropForRatio({ x: 0, y: 0, w: 1, h: 1, rotate: 5 }, 1600, 900, 9 / 16);
    assert.ok(Math.abs(crop.w * 1600 / (crop.h * 900) - 9 / 16) < 1e-8);
    const a = 5 * Math.PI / 180;
    const ex = (crop.w * Math.cos(a) + crop.h * 900 / 1600 * Math.sin(a)) / 2;
    assert.ok(crop.x + crop.w / 2 - ex >= -1e-8);
});

test('dragging the photo moves the source crop oppositely and clamps it', () => {
    const result = photoCropAfterPan({ x: .2, y: .2, w: .5, h: .5 }, .1, -.1);
    assert.ok(Math.abs(result.x - .1) < 1e-12);
    assert.ok(Math.abs(result.y - .3) < 1e-12);
    assert.equal(result.w, .5);
    assert.equal(result.h, .5);
});

test('dragging a rotated photo uses source-pixel rotation', () => {
    const result = photoCropAfterPan({ x: .2, y: .2, w: .5, h: .5, rotate: 10 }, .1, 0, 1600, 900);
    assert.ok(result.x < .2);
    assert.ok(result.y > .2);
});

test('smart crop brings subject toward a thirds intersection', () => {
    const result = smartPhotoCrop({ x: 0, y: 0, w: .5, h: .5 }, { x: .6, y: .2, w: .1, h: .2 });
    assert.ok(Math.abs((.65 - result.x) / result.w - 2 / 3) < 1e-8);
});

test('smart crop opens a movable window from an uncropped photo', () => {
    const result = smartPhotoCrop({ x: 0, y: 0, w: 1, h: 1 }, { x: .6, y: .2, w: .1, h: .2 });
    assert.ok(result.w < 1 && result.h < 1);
    assert.ok(result.x > 0);
});

test('foreground centroid can place the subject on a third', () => {
    const result = smartPhotoCrop({ x: 0, y: 0, w: .5, h: .5 },
        { x: .7, y: .2, w: .1, h: .2, cx: .75, cy: .3 });
    assert.ok(Math.abs((.75 - result.x) / result.w - 2 / 3) < 1e-8);
});

test('portrait smart crop expands around a real foreground subject despite coarse saliency', () => {
    const crop = { x: .3418, y: .012, w: .1678, h: .5302, rotate: 5 };
    const coarseSaliency = { x: .21, y: 0, w: .755, h: .654 };
    const person = { x: .57, y: .03, w: .38, h: .9, cx: .76, cy: .5 };
    const fromSaliency = smartPhotoCrop(crop, coarseSaliency, 1920, 1080);
    const result = smartPhotoCrop(crop, person, 1920, 1080);
    const overlap = Math.max(0, Math.min(result.x + result.w, person.x + person.w) - Math.max(result.x, person.x));
    assert.ok(result.w > crop.w);
    assert.ok(Math.abs(result.w / result.h - crop.w / crop.h) < 1e-10);
    assert.ok(Math.abs((person.cx - result.x) / result.w - 2 / 3) <= .05);
    assert.ok(overlap / person.w >= .7);
    assert.ok(result.x > fromSaliency.x, 'foreground centroid takes priority over the coarse saliency centre');
});

test('foreground mask measured on the portrait fixture stays inside a 9:16 crop', () => {
    const crop = { x: .3418, y: .012, w: .1678, h: .5302, rotate: 5 };
    const focus = { x: .6291666667, y: .0370370370, w: .259375, h: .9629629630,
        cx: .7592443894, cy: .6027224321 };
    const result = smartPhotoCrop(crop, focus, 1920, 1080);
    const overlap = Math.max(0, Math.min(result.x + result.w, focus.x + focus.w) - Math.max(result.x, focus.x));
    assert.ok(Math.abs(result.w / result.h - crop.w / crop.h) < 1e-10);
    assert.ok(Math.abs((focus.cx - result.x) / result.w - 2 / 3) <= .05);
    assert.ok(overlap / focus.w >= .8);
});

test('ratio-constrained edge keeps the opposite edge anchored', () => {
    const before = { x: .1, y: .1, w: .7, h: .7 };
    const result = photoCropConstrainRatioAfterEdge(before, { x: .1, y: .1, w: .4, h: .7 },
        'e', 1600, 900, 9 / 16);
    assert.equal(result.x, before.x);
    assert.equal(result.y, before.y);
    assert.ok(Math.abs(result.w * 1600 / (result.h * 900) - 9 / 16) < 1e-8);
});

test('rotated photo clip maps the centre of the same source crop window', () => {
    const polygon = photoCropClipPolygon({ x: .25, y: .25, w: .5, h: .5, rotate: 5 }, 1600, 900);
    const coordinates = [...polygon.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map(match => [Number(match[1]), Number(match[2])]);
    assert.equal(coordinates.length, 4);
    assert.ok(Math.abs(coordinates.reduce((sum, p) => sum + p[0], 0) / 4 - 50) < 1e-8);
    assert.ok(Math.abs(coordinates.reduce((sum, p) => sum + p[1], 0) / 4 - 50) < 1e-8);
});
