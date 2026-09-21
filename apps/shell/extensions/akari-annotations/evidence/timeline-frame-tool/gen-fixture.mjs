import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderTextCard } from '../../../../../../packages/generate/src/cli/text-card.mjs';

/** All fixtures live under the runner's mkdtemp, never the user's project/home. */
export async function createFixture(project) {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await renderTextCard({ id: 'neighbor', name: '隣のクリップ', prompt: '',
    width: 640, height: 360, outPath: path.join(project, 'assets/neighbor.png'),
    loadPuppeteer: async () => null, resolveBinary: () => { throw new Error('fixture solid'); }, logRenderer() {} });
  const edit = {
    version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'neighbor', path: 'assets/neighbor.png' }],
    tracks: [{ id: 'video', lane: 'visual', name: '映像', items: [
      { id: 'left', at: 0, duration: 30, source: { kind: 'media', src: 'neighbor', in: 0, out: 1 } },
      { id: 'right', at: 240, duration: 60, source: { kind: 'media', src: 'neighbor', in: 0, out: 2 } }
    ] }]
  };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
  return edit;
}
