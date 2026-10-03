import assert from 'node:assert/strict';
import test from 'node:test';
import {
  editSaveErrorMessage, resolveMediaUrl, overlaySignature, fmtRange,
  apiReadError, normalizeVgpuPreviewScale,
} from '../public/preview-format.js';

const response = (status, body) => ({ status, json: async () => body });
const rejectedResponse = status => ({ status, json: async () => { throw new Error('invalid json'); } });

test('preview-format editSaveErrorMessage selects errors and preserves fallback text', async () => {
  const cases = [
    [response(422, { findings: [{ severity: 'error', message: 'bad' }] }), 'bad'],
    [response(422, { findings: [{ severity: 'warning', message: 'warn' }, { severity: 'error', message: 'bad' }] }), 'bad'],
    [response(422, { findings: [{ severity: 'warning', message: 'warn' }] }), 'warn'],
    [response(422, { findings: [] }), '保存に失敗しました (HTTP 422)'],
    [response(409, { error: 'conflict' }), 'conflict'],
    [rejectedResponse(503), '保存に失敗しました (HTTP 503)'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(await editSaveErrorMessage(input), expected);
});

test('preview-format resolveMediaUrl preserves absolute media and escapes local segments', () => {
  const cases = [
    [null, null],
    ['', null],
    ['https://example.test/a b.mp4', 'https://example.test/a b.mp4'],
    ['blob:clip-id', 'blob:clip-id'],
    ['/media/a b.mp4', '/media/a%20b.mp4'],
    ['素材/春.mp4', '/%E7%B4%A0%E6%9D%90/%E6%98%A5.mp4'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(resolveMediaUrl(input), expected);
});

test('preview-format overlaySignature records ordered overlay identity and content', () => {
  const cases = [
    [undefined, '[]'],
    [{ overlays: [] }, '[]'],
    [{ overlays: [{ id: 7, html: '<b>A</b>', start: 1, duration: 2 }] }, '[["7","<b>A</b>",1,2]]'],
    [{ overlays: [{ id: 'a', html: 'A', start: 0, duration: 1 }, { id: 'b', html: 'B', start: 1, duration: 1 }] }, '[["a","A",0,1],["b","B",1,1]]'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(overlaySignature(input), expected);
});

test('preview-format fmtRange keeps source rounding at minute boundaries', () => {
  const cases = [
    [0, '0:00.0'],
    [59.96, '0:60.0'],
    [60, '1:00.0'],
    [125.04, '2:05.0'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(fmtRange(input), expected);
});

test('preview-format apiReadError returns body error or labeled HTTP status', async () => {
  const cases = [
    [[response(503, { error: 'x' }), '音声の取得'], 'x'],
    [[rejectedResponse(502), 'summary'], 'summary: HTTP 502'],
    [[response(500, { error: '' }), '保存'], '保存: HTTP 500'],
    [[response(500, null), 'x'], 'x: HTTP 500'],
    [[response(418, 'body'), undefined], 'undefined: HTTP 418'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(await apiReadError(...input), expected);
});

test('preview-format normalizeVgpuPreviewScale accepts only three numeric presets', () => {
  const cases = [
    [1, 1],
    [0.5, 0.5],
    [0.25, 0.25],
    [undefined, 0.5],
    [NaN, 0.5],
    ['0.5', 0.5],
    [0.3, 0.5],
    [2, 0.5],
    [null, 0.5],
    [0, 0.5],
    [-1, 0.5],
    [Infinity, 0.5],
  ];
  for (const [input, expected] of cases) assert.strictEqual(normalizeVgpuPreviewScale(input), expected);
});
