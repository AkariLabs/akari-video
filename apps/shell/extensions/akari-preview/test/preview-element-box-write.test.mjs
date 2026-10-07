import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoElementWriteConflict, assertPreviewElementStyleAllowed } from '../lib/common/preview-element-write.js';
import { previewElementUndoKind } from '../lib/common/preview-element-undo.js';

const element = style => ({ ref: '.bar[2]', tag: 'div', style });

test('preview element style accepts only its eleven approved names', () => {
  const approved = { translate: '-1.25px 2px', rotate: '15deg', width: '40px', height: '4px',
    'box-sizing': 'border-box', 'min-width': '0px', 'min-height': '0px',
    'max-width': 'none', 'max-height': 'none', flex: '0 0 auto', display: 'inline-block' };
  assert.doesNotThrow(() => assertPreviewElementStyleAllowed(element(approved)));
  for (const name of ['color', 'transform', 'scale', 'background', 'position']) {
    assert.throws(() => assertNoElementWriteConflict({ element: element({ ...approved, [name]: 'red' }) }),
      /許可されないプロパティ/u, name);
  }
});

test('preview element style rejects values outside the value allowlist', () => {
  for (const [name, value] of [['display', 'none'], ['box-sizing', 'content-box'],
    ['flex', '1 1 auto'], ['width', '3px'], ['height', 'auto'], ['rotate', '90rad'],
    ['translate', 'calc(1px + 2px) 0px'], ['min-width', '5px'], ['max-height', '100px']]) {
    assert.throws(() => assertPreviewElementStyleAllowed(element({ [name]: value })),
      /許可されない値/u, `${name}: ${value}`);
  }
  assert.throws(() => assertPreviewElementStyleAllowed(element(null)), /style が不正/u);
  assert.doesNotThrow(() => assertNoElementWriteConflict({ transform: { x: 10 }, html: '<b>x</b>' }));
});

test('undo names move, size and rotation from the element patch', () => {
  assert.equal(previewElementUndoKind({ translate: '2px 3px' }), 'move');
  assert.equal(previewElementUndoKind({ height: '20px', rotate: '30deg' }), 'size');
  assert.equal(previewElementUndoKind({ rotate: '30deg', translate: '2px 3px' }), 'rotate');
});
