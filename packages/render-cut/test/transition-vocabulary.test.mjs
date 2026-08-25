import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { buildMultiSourceCutCommand } from '../src/plan.mjs';

const { TRANSITION_VOCABULARY } = createRequire(import.meta.url)(
  '../../edit-store/lib/index.js'
);

test('正準 29 種は実プラン生成で xfade 名と acrossfade を一致させる', () => {
  for (const transition of TRANSITION_VOCABULARY) {
    const command = buildMultiSourceCutCommand({
      sourceInputs: [
        { id: 'a', path: '/project/a.mp4', hasAudio: true, width: 1280, height: 720 },
        { id: 'b', path: '/project/b.mp4', hasAudio: true, width: 1280, height: 720 },
      ],
      cutPath: '/project/.akari/cut.mp4',
      cuts: [
        { src: 'a', in: 0, out: 2, transition_out: { type: transition.id, duration: 0.5 } },
        { src: 'b', in: 0, out: 2, at: 1.5 },
      ],
      width: 1280,
      height: 720,
      fps: 30,
      ffmpegCommand: 'ffmpeg',
      ffprobeCommand: 'ffprobe',
      projectRoot: '/project',
    });
    const args = command.args.join(' ');
    assert.match(
      args,
      new RegExp(`xfade=transition=${transition.xfadeName}:duration=0\\.5:offset=1\\.5`),
      transition.id
    );
    assert.match(args, /acrossfade=d=0\.5/u, transition.id);
  }
});
