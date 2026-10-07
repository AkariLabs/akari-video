import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreviewItemWrite, resolvePreviewItemWriteBatch } from '../lib/edit-v2-item-write.js';

const base = () => ({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'chart', at: 0, duration: 60,
    source: { kind: 'html', path: 'overlays/chart.html' } }] }] });
const write = (edit, patch, itemId = 'chart') => resolvePreviewItemWrite(JSON.stringify(edit),
  { kind: 'overlay', itemId, patch });
const element = (style, ref = '.bar[2]', tag = 'div') => ({ element: { ref, tag, style } });
const source = result => JSON.parse(result.candidateText).tracks[0].items[0].source;

test('element writes merge properties and remove empty entries', () => {
  let edit = base();
  edit.tracks[0].items[0].source.elements = { '.bar[2]': { style: { color: 'red' } } };
  edit = JSON.parse(write(edit, element({ translate: '4px 5px' })).candidateText);
  assert.deepEqual(edit.tracks[0].items[0].source.elements['.bar[2]'].style,
    { color: 'red', translate: '4px 5px' });
  assert.deepEqual(source(write(edit, element({ translate: null }))).elements,
    { '.bar[2]': { style: { color: 'red' } } });
  assert.equal(source(write(edit, element({ translate: '', color: '' }))).elements, undefined);
});

test('element write rejects part, non-HTML, conflicting patch and batch', () => {
  const edit = base();
  edit.tracks[0].items[0].source.part = 'A';
  assert.throws(() => write(edit, element({ translate: '1px 2px' })), /対象ではありません/);
  delete edit.tracks[0].items[0].source.part;
  edit.tracks[0].items[0].source = { kind: 'group' };
  assert.throws(() => write(edit, element({ translate: '1px 2px' })), /対象ではありません/);
  edit.tracks[0].items[0].source = { kind: 'html', path: 'overlays/chart.html' };
  assert.throws(() => write(edit, { ...element({ translate: '1px 2px' }), transform: { x: 1 } }), /不正/);
  assert.throws(() => resolvePreviewItemWriteBatch(JSON.stringify(edit),
    [{ kind: 'overlay', itemId: 'chart', patch: element({ translate: '1px 2px' }) }]), /バッチ/);
});

test('element write rejects every conflicting overlay field', () => {
  const edit = base();
  const conflicting = {
    transform: { x: 1 }, html: '<div></div>', text: 'x', duplicate: false,
    params: { label: 'x' }, vars: { label: 'x' },
    xyKeyframes: [{ t: 0, transform: { x: 1, y: 2 } }]
  };
  for (const [key, value] of Object.entries(conflicting)) {
    assert.throws(() => write(edit, { ...element({ translate: '1px 2px' }), [key]: value }),
      /要素の書き戻し指定が不正/, key);
  }
});
