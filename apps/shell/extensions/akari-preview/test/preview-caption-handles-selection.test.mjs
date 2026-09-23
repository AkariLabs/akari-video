import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const selection = source.slice(source.indexOf('const selectCaption ='), source.indexOf("captionClampChip.addEventListener('click'"));

test('preview selection synchronizes the cue set and visuals before the same-primary early return', () => {
  assert.match(selection, /selectedCaptionIds = captionId \? new Set\(\[captionId\]\) : new Set\(\);/u);
  assert.match(selection, /applyCaptionSelectionAttrs\(\);[\s\S]*if \(captionId === selectedCaptionId\)/u);
  assert.match(selection, /const deselectCaption = options => selectCaption\(null, options\)/u);
  assert.match(selection, /selectedCaptionId = captionId;/u);
  assert.match(selection, /if \(report\) window\.akari\.reportCaptionSelection\(selectedCaptionId\)/u);
});

test('making a member of a host multi-selection primary retains the entire set', () => {
  assert.match(selection, /if \(!options\?\.preserveGroup && !\(selectedCaptionIds\.size > 1 && selectedCaptionIds\.has\(captionId\)\)\) \{\s*selectedCaptionIds = captionId \? new Set\(\[captionId\]\) : new Set\(\);\s*\}/u);
  const host = source.slice(source.indexOf("if (message && message.type === 'akari-preview-set-selected-captions')"), source.indexOf("if (message && message.type === 'akari-preview-captions-update')"));
  assert.match(host, /selectedCaptionIds = new Set\(Array\.isArray\(message\.captionIds\) \? message\.captionIds : \[\]\);/u);
  assert.match(host, /selectCaption\(selectedCaptionIds\.has\(message\.primaryCaptionId\)/u);
  assert.match(host, /preserveGroup: true/u);
  assert.match(host, /applyCaptionSelectionAttrs\(\);\s*updateCaptionSelectBox\(\);/u);
});

test('recreated rows restore selection after replacing caption contents', () => {
  const row = source.slice(source.indexOf('const renderCaptionRow ='), source.indexOf('const renderCaption ='));
  assert.match(row, /captionPlate\.innerHTML =[\s\S]*applyCaptionRowSelectionAttrs\(captionPlate, caption\);/u);
  const attrs = source.slice(source.indexOf('const applyCaptionRowSelectionAttrs ='), source.indexOf('const setCaptionAltAll ='));
  assert.match(attrs, /selectedCaptionIds\.has\(id\)/u);
  assert.match(attrs, /for \(const row of captionRows\.values\(\)\) applyCaptionRowSelectionAttrs\(row\.plate, row\.caption\)/u);
});
