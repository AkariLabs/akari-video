import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Exercise the TypeScript writer without generating lib/ (the wrapper owns builds).
const require = createRequire(import.meta.url);
Module._extensions['.ts'] = (loaded, filename) => loaded._compile(
  ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText, filename);
const { resolvePreviewItemWrite, resolvePreviewItemWriteBatch } =
  require('../src/edit-v2-item-write.ts');
const { readEditV2 } = require('../src/edit-v2.ts');

const group = (keyframes) => ({ id: 'canvas', at: 0, duration: 180,
  source: { kind: 'group' }, transform: { x: 0, y: 0, scale: 1 }, items: [],
  ...(keyframes ? { keyframes } : {}) });
const documentWith = (item = group()) => ({ version: 2,
  output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'visual', lane: 'visual', items: [item] }] });
const writtenGroup = result => {
  const document = JSON.parse(result.candidateText);
  assert.doesNotThrow(() => readEditV2(document));
  return document.tracks[0].items[0];
};
const assertUniform = transform => {
  assert.ok(transform && typeof transform.scale === 'number');
  assert.equal(Object.hasOwn(transform, 'scaleX'), false);
  assert.equal(Object.hasOwn(transform, 'scaleY'), false);
};

test('group corner scale writes only uniform scale with and without a playhead', () => {
  for (const playheadSeconds of [undefined, 2]) {
    const before = documentWith();
    const result = resolvePreviewItemWrite(JSON.stringify(before), {
      kind: 'overlay', itemId: 'canvas', ...(playheadSeconds === undefined ? {} : { playheadSeconds }),
      patch: { transform: { scale: 1.4 } }
    });
    const after = writtenGroup(result);
    assertUniform(after.transform);
    assert.equal(after.transform.scale, 1.4);
    assert.deepEqual(before.tracks[0].items[0].transform, { x: 0, y: 0, scale: 1 });
  }
});

test('group corner scale writes only scale at animated size points', () => {
  const item = group([{ t: 0, transform: { scale: 1 } },
    { t: 90, transform: { scale: 2 } }]);
  const after = writtenGroup(resolvePreviewItemWrite(JSON.stringify(documentWith(item)), {
    kind: 'overlay', itemId: 'canvas', playheadSeconds: 2,
    patch: { transform: { scale: 1.6 } }
  }));
  assertUniform(after.transform);
  for (const point of after.keyframes) assertUniform(point.transform);
  assert.equal(after.keyframes.find(point => point.t === 60).transform.scale, 1.6);
});

test('group edge axis patch becomes one uniform scale at both write times', () => {
  for (const playheadSeconds of [undefined, 2]) {
    const after = writtenGroup(resolvePreviewItemWrite(JSON.stringify(documentWith()), {
      kind: 'overlay', itemId: 'canvas', ...(playheadSeconds === undefined ? {} : { playheadSeconds }),
      patch: { transform: { scaleX: 1.2, scaleY: 1.8 } }
    }));
    assertUniform(after.transform);
    assert.ok(Math.abs(after.transform.scale - Math.sqrt(1.2 * 1.8)) < 1e-12);
  }
});

test('mixed move and preview batch never add group axes', () => {
  const text = JSON.stringify(documentWith());
  const moved = writtenGroup(resolvePreviewItemWriteBatch(text, [
    { kind: 'overlay', itemId: 'canvas', patch: { transform: { x: 20, y: -10 } } }
  ]));
  assert.deepEqual(moved.transform, { x: 20, y: -10, scale: 1 });
  const resized = writtenGroup(resolvePreviewItemWriteBatch(text, [
    { kind: 'overlay', itemId: 'canvas', playheadSeconds: 2, patch: { transform: { scale: 1.3 } } },
    { kind: 'overlay', itemId: 'canvas', patch: { transform: { x: 20, y: -10 } } }
  ]));
  assertUniform(resized.transform);
  assert.equal(resized.transform.scale, 1.3);
});

test('invalid preexisting group axes are rejected without rewriting the input', () => {
  const input = documentWith(group());
  input.tracks[0].items[0].transform.scaleX = 1.2;
  const before = JSON.stringify(input);
  assert.throws(() => resolvePreviewItemWrite(before, {
    kind: 'overlay', itemId: 'canvas', patch: { transform: { scale: 1.5 } }
  }), /group/u);
  assert.equal(JSON.stringify(input), before);
});
