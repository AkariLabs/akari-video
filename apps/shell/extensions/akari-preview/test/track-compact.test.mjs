import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { readEditV2 } from '@akari-video/edit-store';
import {
  compactVisualTracks,
  trackCompactionProposalAfterMigration,
} from '../lib/common/track-compact.js';

const visualItem = (id, at, duration) => ({
  id,
  at,
  duration,
  source: { kind: 'filter', filter: { type: 'invert' } },
});

const visualTrack = (id, item) => ({ id, lane: 'visual', items: item ? [item] : [] });

function reelLikeEdit() {
  const masks = Array.from({ length: 10 }, (_, index) =>
    visualTrack(`mask-track-${index}`, visualItem(`mask-${index}`, index * 30, 31)));
  const people = Array.from({ length: 10 }, (_, index) =>
    visualTrack(`person-track-${index}`, visualItem(`person-${index}`, index * 30 + 1, 30)));
  return {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'audio-source', path: 'assets/audio.wav' }],
    tracks: [
      {
        id: 'audio',
        lane: 'audio',
        items: [{
          id: 'audio-item',
          at: 0,
          duration: 300,
          source: { kind: 'media', src: 'audio-source', in: 0, out: 10 },
        }],
      },
      visualTrack('cuts', visualItem('cut', 0, 300)),
      visualTrack('panels', visualItem('panel', 0, 300)),
      ...masks.filter((_, index) => index % 2 === 0),
      ...masks.filter((_, index) => index % 2 === 1),
      ...people,
      visualTrack('empty-migrated'),
      { id: 'captions', lane: 'visual', content: { from: 'captions.json' } },
    ],
  };
}

const itemJsonById = edit => new Map(edit.tracks.flatMap(track =>
  'items' in track ? track.items.map(item => [item.id, JSON.stringify(item)]) : []));

test('リール同形 fixture は mask 2 本 + person 1 本と既存 cuts/panels/audio/captions の 7 本へ詰まる', () => {
  const edit = reelLikeEdit();
  const beforeItems = itemJsonById(edit);
  const result = compactVisualTracks(edit);

  assert.equal(result.beforeTrackCount, 25);
  assert.equal(result.afterTrackCount, 7);
  assert.equal(result.changed, true);
  assert.equal(result.edit.tracks.length, 7);
  assert.doesNotThrow(() => readEditV2(result.edit));
  assert.deepEqual(itemJsonById(result.edit), beforeItems, 'item JSON must be unchanged; only placement/order may change');

  const visualItemTracks = result.edit.tracks.filter(track => track.lane === 'visual' && 'items' in track);
  assert.deepEqual(visualItemTracks.map(track => track.items.map(item => item.id)), [
    ['cut'],
    ['panel'],
    ['mask-0', 'mask-2', 'mask-4', 'mask-6', 'mask-8'],
    ['mask-1', 'mask-3', 'mask-5', 'mask-7', 'mask-9'],
    ['person-0', 'person-1', 'person-2', 'person-3', 'person-4', 'person-5', 'person-6', 'person-7', 'person-8', 'person-9'],
  ]);
});

test('開始時刻が逆順でも、時間重複するアイテムの元トラック下→上 z 順を保存する', () => {
  const lower = visualItem('lower-late', 10, 20);
  const upper = visualItem('upper-early', 0, 30);
  const result = compactVisualTracks({
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [],
    tracks: [visualTrack('lower', lower), visualTrack('upper', upper), visualTrack('empty')],
  });
  const zByItem = new Map(result.edit.tracks.flatMap((track, z) =>
    'items' in track ? track.items.map(item => [item.id, z]) : []));

  assert.ok(zByItem.get('lower-late') < zByItem.get('upper-early'));
  assert.doesNotThrow(() => readEditV2(result.edit));
});

test('減らせない v1→v2 遷移では提案を返さず、ダイアログ条件へ入らない', () => {
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [],
    tracks: [visualTrack('only', visualItem('only-item', 0, 30))],
  };

  assert.equal(trackCompactionProposalAfterMigration(1, edit), undefined);
  assert.equal(trackCompactionProposalAfterMigration(undefined, reelLikeEdit()), undefined);
  assert.ok(trackCompactionProposalAfterMigration(0, reelLikeEdit()));
});

test('compactTracks command は read→純関数→lint→write の write-gate 順で登録され、提案は非同期で一度だけ出す', async () => {
  const source = await readFile(
    new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /COMPACT_TRACKS_COMMAND: Command = \{ id: 'akari\.preview\.compactTracks' \}/u);
  assert.match(source, /registerCommand\(COMPACT_TRACKS_COMMAND,[\s\S]*execute: \(request\?: CompactTracksRequest\) => this\.compactTracks\(request\)/u);
  assert.match(source, /const originalText = await this\.readText\(editUri\);[\s\S]*compactVisualTracks\(parsed as EditV2\)[\s\S]*lintEditCandidate\([\s\S]*fileService\.writeFile\(editUri, BinaryBuffer\.fromString\(candidateText\)\)/u);
  assert.match(source, /migrationCompactionPrompted\.add\(editKey\)[\s\S]*trackCompactionProposalAfterMigration\(previousRawVersion, rawEdit\)[\s\S]*if \(proposal\)[\s\S]*window\.setTimeout/u);
  assert.match(source, /if \(choice !== COMPACT_TRACKS_ACTION\) \{\s*return;\s*\}[\s\S]*this\.compactTracks/u);
});
