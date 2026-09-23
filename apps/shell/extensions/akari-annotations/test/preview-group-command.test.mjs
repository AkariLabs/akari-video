import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { indexEditV2Items, removeTreeV2Item } from '../lib/common/edit-v2-mutations.js';

const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const shortcuts = readFileSync(new URL('../src/browser/akari-shortcuts.ts', import.meta.url), 'utf8');

test('preview multi receiver opens ancestors and records item rows without an echo', () => {
  const body = widget.slice(widget.indexOf('    handleOverlayMultiSelection('), widget.indexOf('    runPreviewGroupCommand('));
  assert.match(body, /this\.previewSelectionAncestorIds\(rows, id\)/u);
  assert.match(body, /this\.timelineCollapsedIds\.delete\(ancestor\)/u);
  assert.match(body, /this\.refreshTimelineTreeRows\(\)/u);
  assert.match(body, /this\.selection = undefined;[\s\S]*this\.multiSelection = selected/u);
  assert.match(body, /this\.pushSelectionSnapshot\(\);[\s\S]*this\.applySelectionClass\(\)/u);
  assert.match(body, /if \(bag\)[\s\S]*this\.handleOverlaySelection\(editUri, representative\)/u);
  assert.doesNotMatch(body, /publishPrimaryPreviewSelection/u);
});

test('group guards give a reason and menu command reuses the shortcut mutation', () => {
  assert.match(widget, /ばらすのは 1 つずつ選んでください/u);
  assert.match(widget, /まとめるには 2 つ以上選んでください/u);
  assert.match(widget, /袋の中の部品はまとめられません（先に出してください）/u);
  assert.match(widget, /runPreviewGroupCommand\([\s\S]*this\.runRegisteredShortcut\(/u);
  assert.match(widget, /commitEditMutation\('まとめる', doc =>/u);
  assert.match(widget, /commitEditMutation\('ばらす', doc =>/u);
  assert.match(widget, /notifyPreviewBagGrouping\([\s\S]*this\.previewBagSelection\?\.editUri === editUri/u);
});

test('multi Delete applies tree mutations in order and skips descendants removed with an ancestor', () => {
  const leaf = id => ({ id, at: 0, duration: 30, source: { kind: 'group' }, items: [] });
  const doc = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'v1', lane: 'visual', items: [{ ...leaf('parent'), items: [leaf('a'), leaf('b')] }] }] };
  let next = doc;
  for (const id of ['parent', 'a']) {
    if (indexEditV2Items(next).has(id)) next = removeTreeV2Item(next, id).document;
  }
  assert.equal(indexEditV2Items(next).size, 0);
  assert.deepEqual([...indexEditV2Items(doc).keys()], ['parent', 'a', 'b']);
  const body = widget.slice(widget.indexOf('    protected async performDeleteMultiSelected('),
    widget.indexOf('    protected async ', widget.indexOf('    protected async performDeleteMultiSelected(') + 10));
  assert.match(body, /for \(const id of itemIds\)[\s\S]*indexEditV2Items\(value\)\.has\(id\)[\s\S]*removeTreeV2Item\(value, id\)\.document/u);
  assert.doesNotMatch(body, /removeNested/u);
  assert.match(body, /await this\.writeTimelineSnapshots\(editAfter, captionsAfter\)/u);
  assert.match(body, /this\.pushHistory\(\{/u);
  assert.match(body, /if \(JSON\.stringify\(value\) === serializedBefore && captionsAfter === captionsBefore\) \{[\s\S]*return;[\s\S]*\}[\s\S]*await this\.writeTimelineSnapshots/u);
});

test('timeline-owned selection clears the preview bag marker without clearing preview-origin selection', () => {
  const apply = widget.slice(widget.indexOf('    protected applySelection('), widget.indexOf('    protected publishPrimaryPreviewSelection('));
  const publish = widget.slice(widget.indexOf('    protected publishPrimaryPreviewSelection('), widget.indexOf('    protected shouldToggleMultiSelection('));
  const toggle = widget.slice(widget.indexOf('    protected toggleMultiSelection('), widget.indexOf('    /**', widget.indexOf('    protected toggleMultiSelection(')));
  assert.match(apply, /if \(notifyPreview\) this\.previewBagSelection = undefined/u);
  assert.match(publish, /this\.previewBagSelection = undefined/u);
  assert.match(toggle, /this\.previewBagSelection = undefined/u);
  assert.match(widget, /selectCaptions\([\s\S]*this\.previewBagSelection = undefined/u);
  assert.match(widget, /if \(ids\.length < 2\) \{\s*this\.previewBagSelection = undefined;\s*this\.handleOverlaySelection/u);
});

test('ungroup binding retains the timeline focus gate alongside SCM global binding', () => {
  assert.match(shortcuts, /akari\.timeline\.ungroup'[\s\S]*ctrlcmd\+shift\+g'[\s\S]*when: timeline/u);
  assert.match(shortcuts, /const timeline = 'akariTimelineVisible && !akariModalOpen && !akariEditableFocus && !akariImeComposing'/u);
});
