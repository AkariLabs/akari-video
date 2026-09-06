import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { readInternalEdit } from '@akari-video/edit-store';

// Run the actual summary declarations, including legacy precedence, without Theia DI.
const source = ts.createSourceFile('akari-preview-open-handler.ts', readFileSync(
  new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true);
let statements;
function visit(node) {
  if (ts.isBlock(node) && node.statements.some(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'internalTrackStates'))) {
    statements = node.statements;
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(statements);
const names = new Set([
  'normalizeTrackStates', 'internalTrackStates', 'declaredTrackStates', 'rawTracks',
  'internalCutTracks', 'internalLayerTracks', 'internalAudioTracks',
  'cutTracks', 'layerTracks', 'audioTracks', 'tracks',
]);
const selected = statements.filter(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => names.has(declaration.name.getText(source))));
assert.equal(selected.length, names.size);
const code = ts.transpileModule(selected.map(statement => statement.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const summaryTracks = new Function('internal', `${code}\nreturn tracks;`);

function fixture(muted) {
  return {
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'media', path: 'media.mp4' }],
    tracks: ['visual', 'audio'].map(lane => ({
      id: lane, lane, ...(muted === undefined ? {} : { muted }),
      items: [{ id: `${lane}-item`, at: 0, duration: 30,
        source: { kind: 'media', src: 'media', in: 0, out: 1 } }],
    })),
  };
}

test('v2 track muted reaches summary.tracks.cuts and audio without legacy declarations', () => {
  for (const muted of [true, false, undefined]) {
    const internal = readInternalEdit(fixture(muted));
    assert.equal(internal.declaration.trackStates, undefined);
    const tracks = summaryTracks(internal);
    for (const kind of ['cuts', 'audio']) {
      assert.equal(tracks[kind].length, 1);
      assert.equal(tracks[kind][0].muted, muted);
      assert.equal(Object.hasOwn(tracks[kind][0], 'muted'), muted !== undefined);
      const initialMuted = new Set(tracks[kind].filter(track => track.muted === true).map(track => track.ref));
      assert.equal(initialMuted.has(tracks[kind][0].ref), muted === true);
    }
  }
});

test('legacy trackStates retain precedence over internal mute in preview summary', () => {
  const internal = readInternalEdit(fixture(true));
  internal.declaration.trackStates = { cuts: [{ muted: false }], audio: [{ muted: false }] };
  const tracks = summaryTracks(internal);
  assert.equal(tracks.cuts[0].muted, false);
  assert.equal(tracks.audio[0].muted, false);
});
