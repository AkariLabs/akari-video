import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readEditV2 } from '@akari-video/edit-store/lib/edit-v2.js';
import {
  updateItem,
  updateItemDurationAndShiftFollowing
} from '../lib/common/edit-v2-mutations.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';
import {
  createCutFreezeWriteRequest,
  cutPlaybackDuration,
  isExplicitV0CutTimeline,
  resolveCutFreezeDisplayAt,
  updateCutFreeze
} from '../lib/browser/inspector/freeze-fields.js';

const inspectorSource = readFileSync(
  new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8'
);
const timelineSource = readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
);
const selectionModelSource = readFileSync(
  new URL('../src/browser/timeline-selection-model.ts', import.meta.url), 'utf8'
);

function adjacentCutsDocument() {
  const document = toV2Edit({
    cuts: [
      { in: 0, out: 5 },
      { in: 5, out: 10 },
      { in: 10, out: 15 }
    ]
  });
  document.tracks.push(
    {
      id: 'v-pip', lane: 'visual', items: [{
        id: 'pip-1', at: 150, duration: 60,
        source: { kind: 'html', path: 'pip.html' }
      }]
    },
    {
      id: 'a-voice', lane: 'audio', items: [{
        id: 'voice-1', at: 150, duration: 60,
        source: { kind: 'media', src: 'main', in: 0, out: 2 }
      }]
    }
  );
  return document;
}

function writeFreezeDuration(document, value) {
  const item = document.tracks[0].items.find(candidate => candidate.id === 'cut-1');
  const freeze = updateCutFreeze(item.source.freeze, {
    kind: 'cut-freeze-duration', index: 0, value
  }, 1.5, 5);
  return updateItemDurationAndShiftFollowing(document, {
    itemId: item.id,
    patch: {
      duration: (5 + (freeze?.duration_sec ?? 0)) * 30,
      source: { freeze }
    }
  });
}

function itemById(document, id) {
  return document.tracks.flatMap(track => track.items ?? [])
    .find(candidate => candidate.id === id);
}

test('静止時刻と静止尺の行は index ベースの専用 write kind へ対応する', () => {
  assert.deepEqual([
    createCutFreezeWriteRequest(3, 'at', 1.25),
    createCutFreezeWriteRequest(3, 'duration', 2)
  ], [
    { kind: 'cut-freeze-at', index: 3, value: 1.25 },
    { kind: 'cut-freeze-duration', index: 3, value: 2 }
  ]);
  for (const kind of ['cut-freeze-at', 'cut-freeze-duration']) {
    assert.match(selectionModelSource, new RegExp(`kind: '${kind}'`, 'u'));
  }
});

test('未設定の静止時刻はカット内 playhead を表示し、カット外なら 0 にする', () => {
  assert.equal(resolveCutFreezeDisplayAt(undefined, 12.5, 10, 5), 2.5);
  assert.equal(resolveCutFreezeDisplayAt(undefined, 9.99, 10, 5), 0);
  assert.equal(resolveCutFreezeDisplayAt(undefined, 15.01, 10, 5), 0);
  assert.equal(resolveCutFreezeDisplayAt({ at_sec: 8, duration_sec: 2 }, 12, 10, 5), 5);
});

test('静止尺 > 0 で表示時刻を使った freeze を生成し、at_sec を再生尺内へ clamp する', () => {
  const duration = cutPlaybackDuration({ in: 2, out: 12, speed: 2 });
  assert.equal(duration, 5);
  assert.deepEqual(updateCutFreeze(undefined, {
    kind: 'cut-freeze-duration', index: 0, value: 2
  }, 9, duration), { at_sec: 5, duration_sec: 2 });
  assert.deepEqual(updateCutFreeze({ at_sec: 2, duration_sec: 2 }, {
    kind: 'cut-freeze-at', index: 0, value: 99
  }, 2, duration), { at_sec: 5, duration_sec: 2 });
});

test('静止尺 0 / null は freeze 全体を除去する', () => {
  const current = { at_sec: 1, duration_sec: 2 };
  assert.equal(updateCutFreeze(current, {
    kind: 'cut-freeze-duration', index: 0, value: 0
  }, 1, 5), null);
  assert.equal(updateCutFreeze(current, {
    kind: 'cut-freeze-duration', index: 0, value: null
  }, 1, 5), null);
});

test('freeze 不在時の静止時刻書き込みを案内文付きで拒否する', () => {
  assert.throws(() => updateCutFreeze(undefined, {
    kind: 'cut-freeze-at', index: 0, value: 1
  }, 1, 5), /先に静止尺を設定してください。/u);
});

test('v0 の明示 at / track はフリーズ対象として拒否する', () => {
  assert.equal(isExplicitV0CutTimeline({ in: 0, out: 5, at: 2 }, 0), true);
  assert.equal(isExplicitV0CutTimeline({ in: 0, out: 5, track: 0 }, 0), true);
  assert.equal(isExplicitV0CutTimeline({ in: 0, out: 5 }, 0), false);
  assert.equal(isExplicitV0CutTimeline({ in: 0, out: 5, at: 2 }, 1), false);
  assert.match(timelineSource, /明示 at\/track を使う edit\.json v0 ではフリーズを設定できません。/u);
});

test('v1 書き込みは cuts[].freeze を生成・除去する専用経路を持つ', () => {
  assert.match(timelineSource, /handleLegacyCutFreezeWrite\(/u);
  assert.match(timelineSource, /if \(freeze\) cut\.freeze = freeze;\s+else delete cut\.freeze;/u);
  assert.match(timelineSource, /return \{ ok: false, message: detail \};/u);
});

test('UI は 2 数値行の単位・step・範囲・リセットを配線する', () => {
  assert.match(inspectorSource, /name: 'freeze-at', label: '静止時刻', unit: '秒'/u);
  assert.match(inspectorSource, /name: 'freeze-duration', label: '静止尺', unit: '秒', removable: true/u);
  assert.match(inspectorSource, /scrubStep: 0\.01, min: 0, max: duration/u);
  assert.match(inspectorSource, /scrubStep: 0\.01, min: 0/u);
  assert.match(inspectorSource, /createCutFreezeWriteRequest\(snapshot\.index, 'duration', null\)/u);
});

test('v2 は media item の source.freeze と item 尺を更新し、null で field を除去する', () => {
  const document = toV2Edit({ cuts: [{ in: 0, out: 5 }] });
  const item = document.tracks.flatMap(track => track.items)
    .find(candidate => candidate.source?.kind === 'media');
  const freeze = updateCutFreeze(undefined, {
    kind: 'cut-freeze-duration', index: 0, value: 2
  }, 1.5, 5);
  const written = updateItem(document, {
    itemId: item.id,
    patch: { duration: 7 * 30, source: { freeze } }
  });
  const writtenItem = readEditV2(written).tracks.flatMap(track => track.items)
    .find(candidate => candidate.id === item.id);
  assert.deepEqual(writtenItem.source.freeze, { at_sec: 1.5, duration_sec: 2 });
  assert.equal(writtenItem.duration, 210);

  const removed = updateItem(written, {
    itemId: item.id,
    patch: { duration: 5 * 30, source: { freeze: null } }
  });
  const removedItem = readEditV2(removed).tracks.flatMap(track => track.items)
    .find(candidate => candidate.id === item.id);
  assert.equal(Object.hasOwn(removedItem.source, 'freeze'), false);
  assert.equal(removedItem.duration, 150);
  assert.match(timelineSource, /raw\?\.source\?\.freeze/u);
  assert.match(timelineSource, /source: \{ freeze \}/u);
  assert.match(timelineSource, /playbackDuration \+ \(freeze\?\.duration_sec \?\? 0\)/u);
});

test('隣接 cut の v2 実書き込みは freeze 設定時に同一トラックの全後続 at を Δ シフトして重複を作らない', () => {
  const written = readEditV2(writeFreezeDuration(adjacentCutsDocument(), 2));
  const main = written.tracks.find(track => track.id === 't1');

  assert.deepEqual(main.items.map(item => [item.id, item.at, item.duration]), [
    ['cut-1', 0, 210],
    ['cut-2', 210, 150],
    ['cut-3', 360, 150]
  ]);
  assert.deepEqual(itemById(written, 'cut-1').source.freeze, {
    at_sec: 1.5, duration_sec: 2
  });
  for (let index = 1; index < main.items.length; index++) {
    assert.ok(
      main.items[index - 1].at + main.items[index - 1].duration <= main.items[index].at,
      `${main.items[index - 1].id} と ${main.items[index].id} が重複している`
    );
  }
});

test('隣接 cut の v2 実書き込みは freeze 除去時に同一トラックの後続 at を復帰する', () => {
  const frozen = writeFreezeDuration(adjacentCutsDocument(), 2);
  const removed = readEditV2(writeFreezeDuration(frozen, 0));
  const main = removed.tracks.find(track => track.id === 't1');

  assert.deepEqual(main.items.map(item => [item.id, item.at, item.duration]), [
    ['cut-1', 0, 150],
    ['cut-2', 150, 150],
    ['cut-3', 300, 150]
  ]);
  assert.equal(Object.hasOwn(itemById(removed, 'cut-1').source, 'freeze'), false);
});

test('freeze 尺の v2 実書き込みは他トラックの PiP と音声 item をシフトしない', () => {
  const original = adjacentCutsDocument();
  const frozenDocument = writeFreezeDuration(original, 2);
  const frozen = readEditV2(frozenDocument);
  const removed = readEditV2(writeFreezeDuration(frozenDocument, null));

  for (const document of [frozen, removed]) {
    assert.equal(itemById(document, 'pip-1').at, 150);
    assert.equal(itemById(document, 'voice-1').at, 150);
  }
});

test('freeze 尺と後続シフトは 1 回の全文 mutation として履歴へ積まれる', () => {
  const start = timelineSource.indexOf('protected async handleInspectorWriteV2');
  const end = timelineSource.indexOf('protected selectionKey', start);
  const handler = timelineSource.slice(start, end);

  assert.equal((handler.match(/await this\.commitEditMutation\(/gu) ?? []).length, 1);
  assert.match(handler, /request\.kind === 'cut-freeze-duration'[\s\S]*updateV2ItemDurationAndShiftFollowing/u);
});

test('生成した v1 freeze は packages/schemas validate-edit を通る', t => {
  const schemaRoot = dirname(fileURLToPath(
    new URL('../../../../../packages/schemas/package.json', import.meta.url)
  ));
  const value = JSON.parse(readFileSync(
    join(schemaRoot, 'examples', 'edit-v0-sample', 'edit.json'), 'utf8'
  ));
  value.version = 1;
  value.sources = [{ id: 'main', path: value.source.path, proxy: null }];
  delete value.source;
  value.cuts.forEach(cut => { cut.src = 'main'; });
  value.cuts[0].freeze = updateCutFreeze(undefined, {
    kind: 'cut-freeze-duration', index: 0, value: 2
  }, 1, cutPlaybackDuration(value.cuts[0]));
  const directory = mkdtempSync(join(tmpdir(), 'akari-inspector-freeze-'));
  const editPath = join(directory, 'edit.json');
  writeFileSync(editPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const executed = spawnSync(process.execPath, [join(schemaRoot, 'bin', 'validate-edit.mjs'), editPath], {
    encoding: 'utf8'
  });
  if (executed.error?.code === 'EPERM') {
    t.skip('この Windows sandbox はテスト内の子プロセス起動を許可しない');
    return;
  }
  assert.equal(executed.status, 0, executed.stderr);
});
