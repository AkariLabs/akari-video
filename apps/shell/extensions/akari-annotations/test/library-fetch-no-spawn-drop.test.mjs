import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('widget.ts',
  readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const widget = source.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'AkariAnnotationsWidget');
const method = widget.members.find(member => member.name?.getText(source) === 'addMaterialAt');
const code = ts.transpileModule(`class Harness { ${method.getText(source)} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;

const helpers = {
  IMAGE_LAYER_DEFAULT_DURATION_SECONDS: 5,
  indexEditV2Items: value => new Map(value.tracks.flatMap((track, trackIndex) =>
    track.items.map((item, itemIndex) => [item.id, { trackIndex, itemIndex }]))),
  insertV2Track: (value, { index, lane }) => ({ ...value,
    tracks: value.tracks.toSpliced(index, 0, { id: `track-${value.tracks.length + 1}`, lane, items: [] }) }),
  insertV2Item: (value, id, item) => ({ ...value,
    tracks: value.tracks.map(track => track.id === id
      ? { ...track, items: [...track.items, item] } : track) }),
  materialOverlapInsertIndex: () => undefined,
  stringifyEditV2: value => JSON.stringify(value),
};
const Harness = new Function(...Object.keys(helpers), `${code}\nreturn Harness;`)(...Object.values(helpers));

test('5 件の addMaterialAt が同時でも edit の 5 件と履歴を保つ', async () => {
  let edit = JSON.stringify({ version: 2, fps: 30, tracks: [], sources: [] });
  const history = [];
  const instance = new Harness();
  instance.editMutationTail = Promise.resolve();
  instance.materialSwap = null;
  instance.location = { editUri: { toString: () => 'edit.json' }, root: {} };
  instance.messages = { warn() {}, error(message) { throw new Error(message); } };
  instance.footer = { textContent: '' };
  instance.fps = 30;
  instance.frameAt = seconds => Math.round(seconds * 30);
  instance.refreshReferenceMediaUris = async () => {};
  instance.fileService = { readFile: async () => {
    const snapshot = edit;
    await Promise.resolve();
    return { value: { toString: () => snapshot } };
  } };
  instance.writeTimelineSnapshots = async after => { await Promise.resolve(); edit = after; };
  instance.reloadEdit = async () => {};
  instance.pushHistory = entry => history.push(entry);
  instance.beyondCutsEndNote = () => '';
  instance.hideNotice = () => {};
  instance.focusTimelineItem = async () => true;
  instance.revealOutputPreview = () => {};
  const ids = await Promise.all(Array.from({ length: 5 }, (_, n) =>
    instance.addMaterialAt(`assets/still/image-${n}.png`, 'image', n, 0)));
  assert.equal(new Set(ids).size, 5);
  const final = JSON.parse(edit);
  assert.equal(final.sources.length, 5);
  assert.equal(final.tracks.flatMap(track => track.items).length, 5);
  assert.equal(history.length, 5);
  for (let n = 4; n >= 0; n--) {
    await history[n].undo();
    assert.equal(JSON.parse(edit).tracks.flatMap(track => track.items).length, n);
  }
  for (let n = 0; n < history.length; n++) {
    await history[n].redo();
    assert.equal(JSON.parse(edit).tracks.flatMap(track => track.items).length, n + 1);
  }
});
