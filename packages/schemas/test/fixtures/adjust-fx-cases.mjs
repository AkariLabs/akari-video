import { readFileSync } from 'node:fs';

export const fxExamples = [
  ['valid', null],
  ['group2-valid', null],
  ['group2-range-invalid', 'adjust.fx.range'],
  ['unknown-id-invalid', 'adjust.fx.id'],
  ['range-invalid', 'adjust.fx.range'],
  ['duplicate-invalid', 'adjust.fx.duplicate-id'],
].map(([name, check]) => {
  const url = new URL('../../examples/edit-v2-adjust-fx-' + name + '/edit.json', import.meta.url);
  return { name, check, url, edit: JSON.parse(readFileSync(url, 'utf8')) };
});

export const invalidFxCases = [
  ['nonarray', { fx: {} }, 'adjust.fx.structure'],
  ['null array', { fx: null }, 'adjust.fx.structure'],
  ['nonobject entry', { fx: [null] }, 'adjust.fx.structure'],
  ['array entry', { fx: [[]] }, 'adjust.fx.structure'],
  ['missing id', { fx: [{}] }, 'adjust.fx.id'],
  ['inherited id', { fx: [{ id: 'toString' }] }, 'adjust.fx.id'],
  ['extra parameter', { fx: [{ id: 'blur', amount: 0.2 }] }, 'adjust.unknown-key'],
  ...['glow', 'clarity', 'dehaze', 'denoise', 'motion_blur'].map(id =>
    ['extra group two parameter: ' + id, { fx: [{ id, unknown: 1 }] }, 'adjust.unknown-key']),
  ['nine entries', { fx: Array.from({ length: 9 }, () => ({ id: 'blur' })) }, 'adjust.fx.max-items'],
  ['nonboolean section', { sections: { fx: 'off' } }, 'adjust.sections.fx'],
  ...Object.entries({
    vignette: { amount: [-1, 1], midpoint: [0, 1], roundness: [-1, 1], feather: [0, 1] },
    blur: { px: [0, 50] },
    grain: { amount: [0, 1], size: [0.5, 4] },
    sharpen: { amount: [0, 1] },
    glow: { intensity: [0, 1], radius: [0, 100], threshold: [0, 1], warmth: [-1, 1] },
    clarity: { amount: [-1, 1], radius: [1, 50] },
    dehaze: { amount: [-1, 1] },
    denoise: { amount: [0, 1] },
    motion_blur: { px: [0, 100], angle: [-180, 180] },
  }).flatMap(([id, params]) => Object.entries(params).flatMap(([key, [min, max]]) =>
    [min - 0.01, max + 0.01, '0', null, NaN, Infinity, -Infinity].map(value =>
      [id + '.' + key + '=' + String(value), { fx: [{ id, [key]: value }] }, 'adjust.fx.range']))),
];

export const validGroup2FxCases = [
  { fx: ['glow', 'clarity', 'dehaze', 'denoise', 'motion_blur'].map(id => ({ id })) },
  ...[0, 1].map(edge => ({ fx: [
    { id: 'glow', intensity: edge, radius: edge * 100, threshold: edge, warmth: edge * 2 - 1 },
    { id: 'clarity', amount: edge * 2 - 1, radius: 1 + edge * 49 },
    { id: 'dehaze', amount: edge * 2 - 1 }, { id: 'denoise', amount: edge },
    { id: 'motion_blur', px: edge * 100, angle: edge * 360 - 180 },
  ] })),
];
