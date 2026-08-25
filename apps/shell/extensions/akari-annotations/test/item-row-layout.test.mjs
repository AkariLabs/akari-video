import assert from 'node:assert/strict';
import test from 'node:test';

import editStore from '@akari-video/edit-store';
import { indexEditV2Items } from '../lib/common/edit-v2-mutations.js';
import { resolveItemRowLayout } from '../lib/common/item-row-layout.js';

const { projectLegacyEdit, readInternalEdit } = editStore;

test('id 一致行を kind/ref より優先して返す', () => {
  const correct = { id: 'v-mixed', kind: 'overlays', track: 1 };
  const legacyMatch = { id: 'v-other', kind: 'cuts', track: 0 };
  assert.equal(
    resolveItemRowLayout([correct, legacyMatch], 'v-mixed', 'cuts', 0),
    correct
  );
});

test('itemTrackId が undefined なら (kind, ref) へフォールバックする', () => {
  const fallback = { id: 'legacy-cuts', kind: 'cuts', track: 2 };
  assert.equal(resolveItemRowLayout([fallback], undefined, 'cuts', 2), fallback);
});

test('itemTrackId に一致する行が無ければ (kind, ref) へフォールバックする', () => {
  const fallback = { id: 'legacy-overlay', kind: 'overlays', track: 3 };
  assert.equal(resolveItemRowLayout([fallback], 'missing-track', 'overlays', 3), fallback);
});

test('id 一致行も (kind, ref) 一致行も無ければ undefined を返す', () => {
  const layouts = [{ id: 'v1', kind: 'overlays', track: 0 }];
  assert.equal(resolveItemRowLayout(layouts, 'missing-track', 'cuts', 1), undefined);
});

test('html 先頭の混在 v2 トラックでも media cuts は所属トラック行へ解決される', () => {
  const edit = {
    version: 2,
    output: { width: 1080, height: 1920, fps: 30 },
    sources: [
      { id: 's01', path: 'assets/a.jpg' },
      { id: 's02', path: 'assets/b.jpg' }
    ],
    tracks: [
      { id: 'v1', lane: 'visual', name: '本編', items: [
        { id: 'logo-01', at: 0, duration: 90,
          source: { kind: 'html', path: 'overlays/logo.html' } },
        { id: 'clip-01', at: 90, duration: 240,
          source: { kind: 'media', src: 's01', in: 0, out: 8 } },
        { id: 'clip-02', at: 330, duration: 90,
          source: { kind: 'media', src: 's02', in: 0, out: 3 } }
      ] },
      { id: 'v2', lane: 'visual', name: 'テロップ', items: [
        { id: 'telop-01', at: 120, duration: 60,
          source: { kind: 'html', path: 'overlays/t.html' } }
      ] }
    ]
  };

  const internal = readInternalEdit(edit);
  const view = projectLegacyEdit(internal);
  const timelineTracks = view.timeline?.tracks ?? [];
  assert.equal(timelineTracks.some(track => track.kind === 'cuts'), false);

  const layouts = timelineTracks.map(track => ({
    id: track.id,
    kind: track.kind,
    track: track.ref ?? 0
  }));
  const expectedLayout = layouts.find(layout => layout.id === 'v1');
  assert.ok(expectedLayout);

  const itemLocations = indexEditV2Items(edit);
  const cutItemIds = [];
  for (const track of internal.tracks) {
    for (const item of track.items) {
      if (item.legacy.collection === 'cuts') {
        cutItemIds[item.legacy.index] = item.id;
      }
    }
  }

  assert.equal(view.cuts.length, 2);
  view.cuts.forEach((cut, index) => {
    const itemTrackId = itemLocations.get(cutItemIds[index] ?? '')?.trackId;
    assert.equal(
      resolveItemRowLayout(layouts, itemTrackId, 'cuts', cut.track),
      expectedLayout
    );
  });
});
