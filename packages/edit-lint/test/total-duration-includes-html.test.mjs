import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';

setLanguage('ja');
after(() => setLanguage(undefined));

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { lintProject } from '../src/edit-lint.mjs';

// 実機報告 §2 の最小形。media（静止画・映像）は 167.3 秒で終わるが、html オーバーレイ
// （3D シーン・テロップ）は 177.2 秒まで続く。総尺は visual レーンの全アイテムの最大終端
// なので、字幕のクランプ判定も 177.2 秒を分母にしなければならない。
const MEDIA_END_FRAMES = 5019; // 167.3s @ 30fps
const HTML_END_FRAMES = 5316; // 177.2s @ 30fps

async function withHtmlTailProject(callback) {
  const root = await mkdtemp(join(tmpdir(), 'edit-lint-html-tail-duration-'));
  try {
    await mkdir(join(root, 'overlays'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'overlays', 'tail.html'), '<div>tail</div>\n');
    await writeFile(join(root, 'assets', 'main.mp4'), '');
    await writeFile(join(root, 'edit.json'), `${JSON.stringify({
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [
        { id: 'main', path: 'assets/main.mp4' },
        { id: 'tail', path: 'overlays/tail.html' },
      ],
      tracks: [
        { id: 'video', lane: 'visual', items: [{
          id: 'main-1', at: 0, duration: MEDIA_END_FRAMES,
          source: { kind: 'media', src: 'main', in: 0, out: 167.3 },
        }] },
        { id: 'overlays', lane: 'visual', items: [{
          id: 'tail-1', at: MEDIA_END_FRAMES, duration: HTML_END_FRAMES - MEDIA_END_FRAMES,
          source: { kind: 'html', path: 'overlays/tail.html' },
        }] },
      ],
    }, null, 2)}\n`);
    await writeFile(join(root, 'captions.json'), `${JSON.stringify({
      captions: [{
        id: 'c-0001', start: 170, end: 177.2, text: '末尾の字幕',
        speaker: null, sourceRef: null, edited: false, time_domain: 'output',
      }],
    }, null, 2)}\n`);
    await callback(await lintProject(root, { writeReports: false }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('html の終端が media より後ろでも字幕クランプは総尺 177.2 秒で判定する', async () => {
  await withHtmlTailProject((result) => {
    const clampFindings = result.findings.filter(
      (finding) => finding.check === 'captions.output-domain-exceeds-duration',
    );
    assert.deepEqual(clampFindings, [], JSON.stringify(result.findings, null, 2));
    const derived = result.findings.filter((finding) => finding.check === 'timeline.duration-derived');
    assert.equal(derived.length, 1, JSON.stringify(result.findings, null, 2));
    assert.match(derived[0].message, /177\.2/u);
  });
});
