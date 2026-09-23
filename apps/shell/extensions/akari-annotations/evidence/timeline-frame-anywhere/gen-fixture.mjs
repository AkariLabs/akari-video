import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderTextCard } from '../../../../../../packages/generate/src/cli/text-card.mjs';
import { resolveFfmpeg } from '../../../../../../packages/media-bin/src/index.mjs';

/** All fixtures live under the runner's mkdtemp, never the user's project/home. */
export async function createFixture(project) {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await renderTextCard({ id: 'neighbor', name: '隣のクリップ', prompt: '',
    width: 640, height: 360, outPath: path.join(project, 'assets/neighbor.png'),
    loadPuppeteer: async () => null, resolveBinary: () => { throw new Error('fixture solid'); }, logRenderer() {} });
  execFileSync(resolveFfmpeg(), ['-v', 'error', '-f', 'lavfi', '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', '1', '-c:a', 'pcm_s16le',
    '-y', path.join(project, 'assets', 'voice.wav')]);
  const edit = {
    version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'neighbor', path: 'assets/neighbor.png' }, { id: 'voice', path: 'assets/voice.wav' }],
    tracks: [
      { id: 'audio', lane: 'audio', items: [
        { id: 'voice-1', role: 'narration', at: 0, duration: 30,
          source: { kind: 'media', src: 'voice', in: 0, out: 1 } }
      ] },
      { id: 'video', lane: 'visual', items: [
        { id: 'left', at: 0, duration: 30, source: { kind: 'media', src: 'neighbor', in: 0, out: 1 } },
        { id: 'extent', at: 360, duration: 30, source: { kind: 'media', src: 'neighbor', in: 0, out: 1 } }
      ] }
    ]
  };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
  return edit;
}
