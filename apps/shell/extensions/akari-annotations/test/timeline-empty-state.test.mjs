import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTimelineEdit, relativeTimelineMaterialPath, timelineEmptyStateMessage } from '../lib/common/timeline-empty-state.js';
import { writeFallbackTemplate } from '../../../../../packages/project-scaffold/src/index.mjs';

test('edit.json が無いときだけ開始案内を返す', () => {
  assert.equal(typeof timelineEmptyStateMessage(false), 'string');
  assert.ok(timelineEmptyStateMessage(false).length > 0);
  assert.equal(timelineEmptyStateMessage(true), undefined);
});

test('browser の最小編集は project-scaffold の FALLBACK_EDIT_JSON と一致する', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-timeline-empty-'));
  try {
    // scaffold の値を再掲せず、正本の生成 API と比較して雛形のドリフトを検出する。
    // Node 専用 API の import はテストに限定し、browser の依存には入れない。
    await writeFallbackTemplate(root);
    const scaffold = JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8'));
    assert.deepEqual(createTimelineEdit(), scaffold);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('生成した編集を変更しても次の新規編集には影響しない', () => {
  const first = createTimelineEdit();
  const expected = createTimelineEdit();
  first.output.width = 1;
  first.sources.push({ id: 'src-1' });
  first.tracks.push({ id: 'track-1', items: [] });
  assert.deepEqual(createTimelineEdit(), expected);
});

test('初回素材は生成先から解決できる参照にする（root/project・root・ネスト）', () => {
  for (const [directory, material, expected] of [
    ['/work/project', '/work/assets/take.mp4', '../assets/take.mp4'],
    ['/work', '/work/assets/take.mp4', 'assets/take.mp4'],
    ['/work/project', '/work/project/assets/photo.png', 'assets/photo.png'],
    ['/work/planning/cut', '/work/assets/声.wav', '../../assets/声.wav'],
    ['/c:/My Project/project', '/c:/My Project/assets/clip 1.mp4', '../assets/clip 1.mp4'],
  ]) assert.equal(relativeTimelineMaterialPath(directory, material), expected);
});
