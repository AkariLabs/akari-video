import assert from 'node:assert/strict';
import test from 'node:test';
import { previewSelectionHandlesStyle } from '../lib/browser/preview-selection-handles-style.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();

test('photo selection and brush activate pointer input only while active', () => {
  const ordinary = previewSelectionHandlesStyle.indexOf('#layer-select-box.is-active, #cut-select-box.is-active');
  const photo = previewSelectionHandlesStyle.indexOf('#layer-select-box.is-active.akari-photo-pointer-mode');
  assert.ok(ordinary >= 0 && photo > ordinary);
  assert.match(previewSelectionHandlesStyle.slice(photo), /#cut-select-box\.is-active\.akari-photo-pointer-mode \{ pointer-events: auto; \}/u);
  assert.match(source, /photoSelect = layer \|\| cut[\s\S]*?targetBox\.classList\.add\('akari-photo-pointer-mode'\)/u);
  assert.match(source, /photoBrush = \{ itemId:[\s\S]*?layerSelectBox\.classList\.add\('akari-photo-pointer-mode'\)/u);
  assert.match(source, /photoBrush = null;[\s\S]*?layerSelectBox\.classList\.remove\('akari-photo-pointer-mode'\)/u);
  assert.match(source, /layerSelectBox\.addEventListener\('pointermove'[\s\S]*?reportPhotoHover/u);
});
