import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addScriptLine, firstCaptionAfter, formatScriptTime, nextScriptMemoId, orderScriptDisplayLines, parseScriptLines,
  readScriptLines, removeScriptLine, toggleScriptPlanDone, updateScriptLine
} from '../lib/common/daihon-script-lines.js';

test('tolerant read, sorted mutations, and immutable source', () => {
  const source = readScriptLines({ future: true, lines: [
    { id: 'z', kind: 'memo', at: 4, text: 'note', custom: 'kept' },
    { id: 'bad', kind: 'memo', at: -1, text: 'bad' },
    { id: 'p', kind: 'plan', at: 2, text: 'plan' }
  ] });
  assert.deepEqual(source.lines.map(line => line.id), ['p', 'z']);
  const added = addScriptLine(source, { id: 'a', kind: 'memo', at: 4, text: 'new', author: 'user' });
  assert.deepEqual(added.lines.map(line => line.id), ['p', 'a', 'z']);
  const edited = updateScriptLine(added, 'z', { text: 'changed', at: 1 });
  assert.deepEqual(edited.lines.map(line => line.id), ['z', 'p', 'a']);
  assert.equal(edited.lines[0].custom, 'kept');
  assert.equal(source.lines[1].text, 'note');
  assert.equal(toggleScriptPlanDone(edited, 'p').lines[1].done, true);
  assert.deepEqual(removeScriptLine(edited, 'a').lines.map(line => line.id), ['z', 'p']);
  assert.equal(nextScriptMemoId([{ id: 'm-0001', kind: 'memo', at: 0, text: 'a' }]), 'm-0002');
});

test('existing malformed JSON fails strict parsing instead of becoming an empty document', () => {
  assert.throws(() => parseScriptLines('{ "lines": ['), SyntaxError);
  assert.deepEqual(parseScriptLines('{"version":0,"kind":"akari-script","lines":[]}').lines, []);
});

test('mixed display order is chronological, and equal-time captions precede script lines', () => {
  const captions = [{ id: 'c-late', start: 10 }, { id: 'c-early', start: 2 },
    { id: 'c-next', start: 6 }, { id: 'c-tie', start: 4 }];
  const lines = [{ id: 'p', kind: 'plan', at: 4, text: 'Plan' },
    { id: 'm', kind: 'memo', at: 8, text: 'Memo' }];
  assert.equal(firstCaptionAfter(captions.map(caption => ({ ...caption, at: caption.start })), 4).id, 'c-next');
  assert.deepEqual(orderScriptDisplayLines(captions, lines).map(row =>
    row.kind === 'caption' ? row.caption.id : row.line.id), ['c-early', 'c-tie', 'p', 'c-next', 'm', 'c-late']);
  assert.equal(formatScriptTime(12.5), '0:12.50');
});
