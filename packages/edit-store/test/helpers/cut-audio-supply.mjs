import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { projectSpeechDeclarations } from '../../lib/index.js';

export function splitFixture() {
  return JSON.parse(readFileSync(new URL('../../../schemas/examples/edit-v2-cut-audio-split-valid/edit.json', import.meta.url), 'utf8'));
}

export function unsplitFixture() {
  const edit = splitFixture();
  delete edit.tracks[0].items[0].audio;
  edit.tracks[0].items[0].source.gain_db = -3;
  edit.tracks[1].items = [
    { id: 'hit', at: 30, duration: 30, role: 'sfx', gain_db: -6,
      source: { kind: 'media', src: 'main', in: 0, out: 1 } },
    { id: 'narrator', at: 45, duration: 30, role: 'narration', gain_db: -2,
      source: { kind: 'media', src: 'main', in: 1, out: 2 } },
  ];
  return edit;
}

// Exercise the actual browser adapter functions without starting a browser or bundling.
export function previewAdapter() {
  const source = readFileSync(new URL('../../../preview-server/src/frame-engine-client.ts', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function mediaUrl('), source.indexOf('function resolvedItemAdjust('));
  return vm.runInNewContext(`${stripTypeScriptTypes(functions)}\n({ audioDeclarations, speechDeclarations })`, {
    normalizedCuts: edit => edit.cuts ?? [], projectSpeechDeclarations,
  });
}

export function decodedAudio(view) {
  return {
    ...(view.bgm ? { bgm: { ...view.bgm, durationSec: 3 } } : {}),
    sfx: view.sfx.map(item => ({ ...item, durationSec: 3 })),
    narration: [...view.narration.map(item => ({ ...item, durationSec: 3 })),
      ...(view.speech ?? []).map(item => ({ ...item, durationSec: 3, duckKey: true }))],
  };
}

export function baseline() {
  return JSON.parse(readFileSync(new URL('../cut-audio-supply.snapshot.json', import.meta.url), 'utf8'));
}

export const plain = value => JSON.parse(JSON.stringify(value));
