// L1 fixture（ラッパーが検証用に用意する素材）: 静止画 1 本・隣 1 本・動画予定 1 本・隣 1 本。
// すべて runner の mkdtemp 配下に作る（ユーザーのプロジェクト / ホームには触らない）。
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTextCard } from '../../../../../../packages/generate/src/cli/text-card.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const NEXT_META = path.join(ROOT, '../../test/fixtures/generation-states/assets/generated/next-first-last.png.meta.json');

const card = (project, id, name, file) => renderTextCard({ id, name, prompt: '', width: 640, height: 360,
  outPath: path.join(project, file), loadPuppeteer: async () => null,
  resolveBinary: () => { throw new Error('fixture solid'); }, logRenderer() {} });

export async function createFixture(project) {
  await mkdir(path.join(project, 'assets/generated'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await card(project, 'still', '静止画', 'assets/still.png');
  await card(project, 'neighbor', '隣のクリップ', 'assets/neighbor.png');
  await card(project, 'plan', '動画予定', 'assets/generated/plan.png');
  const meta = JSON.parse(await readFile(NEXT_META, 'utf8'));
  const sha = createHash('sha256').update(await readFile(path.join(project, 'assets/generated/plan.png'))).digest('hex');
  meta.result.path = 'assets/generated/plan.png';
  meta.result.sha256 = sha;
  meta.next.inputs.first_frame = { path: 'assets/generated/plan.png', sha256: sha };
  delete meta.next.inputs.last_frame;
  meta.next.inputs.frames_or_refs = 'frames';
  meta.next.output.duration_s = 5;
  // 整数秒のモデルは 3.5 秒を丸める。H3 は下限 5 秒で 3.5→5 となり見積が動かないため、
  // 2〜15 秒・単価 $0.1/秒の Wan 2.7 を使う（3.5 秒の丸め先でも見積が変わる）。
  meta.next.model = { id: 'fal:wan-2.7-i2v' };
  await writeFile(path.join(project, 'assets/generated/plan.png.meta.json'), JSON.stringify(meta, null, 2) + '\n');
  const edit = {
    version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [
      { id: 'still', path: 'assets/still.png' },
      { id: 'neighbor', path: 'assets/neighbor.png' },
      { id: 'plan', path: 'assets/generated/plan.png' }
    ],
    tracks: [{ id: 'video', lane: 'visual', name: '映像', items: [
      { id: 'still', at: 0, duration: 60, source: { kind: 'media', src: 'still', in: 0, out: 2 } },
      { id: 'n1', at: 300, duration: 60, source: { kind: 'media', src: 'neighbor', in: 0, out: 2 } },
      { id: 'plan', at: 450, duration: 150, source: { kind: 'media', src: 'plan', in: 0, out: 5 } },
      { id: 'n2', at: 690, duration: 60, source: { kind: 'media', src: 'neighbor', in: 0, out: 2 } }
    ] }]
  };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
  return edit;
}
