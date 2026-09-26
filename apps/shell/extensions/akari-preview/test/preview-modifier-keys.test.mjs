import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

function between(text, start, end) {
  const startMatch = text.match(start);
  assert.ok(startMatch, `Missing section start: ${start}`);
  const rest = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = rest.match(end);
  assert.ok(endMatch, `Missing section end: ${end}`);
  return rest.slice(0, endMatch.index);
}

test('all four native snap bypass guards use current move Command, never Shift or Alt', () => {
  const guards = [...source.matchAll(/\bif\s*\(\s*(moveEvent\.metaKey\s*\|\|\s*moveEvent\.ctrlKey\s*\|\|\s*!window\.akari\.interaction[^)]*)\)/g)];
  assert.equal(guards.length, 4);
  for (const [, guard] of guards) {
    assert.match(guard, /^moveEvent\.metaKey\s*\|\|\s*moveEvent\.ctrlKey\s*\|\|/);
    assert.doesNotMatch(guard, /shiftKey|altKey/);
  }
  assert.doesNotMatch(source, /moveEvent\.shiftKey\s*\|\|\s*!window\.akari\.interaction/);
});

test('layer rotation snaps the absolute angle to 45 degrees unless Command is held', () => {
  const rotateBlock = between(source, /if\s*\(\s*kind\s*===\s*'rotate'\s*\)\s*\{/, /\}\s*else\s*\{/);
  const callback = between(rotateBlock,
    /beginMediaTransformDrag\s*\(\s*layerDragTarget\s*\(\s*entry\s*\)\s*,\s*event\s*,\s*\(\s*moveEvent\s*,\s*original\s*\)\s*=>\s*\{/,
    /\}\s*\)\s*;/);
  assert.match(callback, /const\s+rotate\s*=\s*original\.rotate\s*\+\s*\(\s*angle\s*-\s*startAngle\s*\)\s*;/);
  assert.match(callback, /rotate:\s*window\.akariHandleGeometry\?\.snapAngle\(rotate,[\s\S]*?moveEvent\.metaKey\s*\|\|\s*moveEvent\.ctrlKey\)\s*\?\?\s*rotate/);
});

test('caption rotation previews and persists the same 45-degree patch; Alt targeting stays intact', () => {
  const drag = between(source, /const\s+beginCaptionHandleDrag\s*=/, /captionLayer\.addEventListener\s*\(\s*'pointerdown'/);
  const onMove = between(drag, /const\s+onMove\s*=\s*moveEvent\s*=>\s*\{/, /\}\s*;\s*const\s+finish\s*=/);
  assert.match(onMove, /if\s*\(\s*!moveEvent\.metaKey\s*&&\s*!moveEvent\.ctrlKey\s*\)\s*\{[\s\S]*?Math\.round\(angle\s*\/\s*45\)\s*\*\s*45;[\s\S]*?Math\.abs\(angle\s*-\s*target\)\s*<=\s*4/);
  assert.match(onMove, /lastPatch\s*=\s*patch\s*;[\s\S]*?captionPlate\.style\.setProperty\s*\(\s*'--caption-rotate'\s*,\s*patch\.rotate\s*\+\s*'deg'\s*\)/);

  const finish = between(drag, /const\s+finish\s*=\s*async\s+cancelled\s*=>\s*\{/, /\}\s*;\s*const\s+onUp\s*=/);
  assert.match(finish, /const\s+patch\s*=\s*lastPatch\s*;\s*pendingCaptionDragReload\s*=\s*true\s*;\s*try\s*\{\s*await\s+window\.akari\.engine\.captionWrite\s*\(\s*cueId\s*,\s*\{\s*plateTransform\s*:\s*\{\s*captionIds\s*:\s*targets\s*,\s*\.\.\.patch\s*\}\s*\}\s*\)\s*;/);
  assert.match(drag, /const\s+altAll\s*=\s*event\.altKey\s*\|\|\s*captionAltAll\s*;\s*setCaptionGroupMode\s*\(\s*altAll\s*\)\s*;\s*const\s+targets\s*=\s*captionHandleTargets\s*\(\s*\[\s*\.\.\.selectedCaptionIds\s*\]\s*,\s*cueId\s*,\s*captions\.map\s*\(\s*candidate\s*=>\s*candidate\.sourceCueId\s*\|\|\s*candidate\.id\s*\)\s*,\s*altAll\s*\)\s*;/);
});

test('caption Escape cancels without writes or deselection, ignores IME; Enter and active blur save', () => {
  const edit = between(source, /const\s+restoreCaptionEditAttribute\s*=/, /const\s+beginCaptionHandleDrag\s*=/);
  const cancel = between(edit, /const\s+cancelCaptionEdit\s*=\s*\(\s*\)\s*=>\s*\{/, /\}\s*;\s*const\s+commitCaptionEdit\s*=/);
  assert.match(cancel, /^\s*if\s*\(\s*!activeCaptionEdit\s*\)\s*return\s*;\s*const\s+edit\s*=\s*activeCaptionEdit\s*;\s*activeCaptionEdit\s*=\s*null\s*;\s*window\.akari\.reportCaptionEditFocus\?\.\(false\)\s*;\s*window\.akari\.syncRunSelection\?\.\(\)\s*;\s*restoreCaptionEditElement\s*\(\s*edit\s*\)\s*;\s*rerenderCaptionAfterEdit\s*\(\s*\)\s*;\s*$/);
  assert.doesNotMatch(cancel, /captionWrite|deselectCaption/);

  const keydown = between(edit, /captionLayer\.addEventListener\s*\(\s*'keydown'\s*,\s*event\s*=>\s*\{/, /\}\s*\)\s*;/);
  assert.match(keydown, /^\s*if\s*\(\s*!activeCaptionEdit\s*\|\|\s*event\.target\s*!==\s*activeCaptionEdit\.element\s*\|\|\s*event\.isComposing\s*\)\s*return\s*;/);
  const escape = between(keydown, /if\s*\(\s*event\.key\s*===\s*'Escape'\s*\)\s*\{/, /\}/);
  assert.match(escape, /\bcancelCaptionEdit\s*\(\s*\)\s*;/);
  assert.doesNotMatch(escape, /commitCaptionEdit/);
  const enter = between(keydown, /if\s*\(\s*event\.key\s*===\s*'Enter'\s*\)\s*\{/, /\}/);
  assert.match(enter, /\bcommitCaptionEdit\s*\(\s*\)\s*;/);

  const blur = between(edit, /captionLayer\.addEventListener\s*\(\s*'blur'\s*,\s*event\s*=>\s*\{/, /\}\s*,\s*true\s*\)\s*;/);
  assert.match(blur, /^\s*if\s*\(\s*activeCaptionEdit\s*&&\s*event\.target\s*===\s*activeCaptionEdit\.element\s*\)\s*\{\s*void\s+commitCaptionEdit\s*\(\s*\)\s*;\s*\}\s*$/);
});
