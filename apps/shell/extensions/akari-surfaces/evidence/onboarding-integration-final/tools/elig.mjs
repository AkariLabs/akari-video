// 検証用（ラッパー所掌）: render-cut と同じ経路で GPU eligibility を直接評価する。node elig.mjs <project>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const WT = '<WORKTREE>';
const rc = await import(pathToFileURL(`${WT}/packages/render-cut/src/render-cut.mjs`));
const { evaluateGpuEligibility } = await import(pathToFileURL(`${WT}/packages/gpu-export/src/eligibility.mjs`));
import { createRequire } from 'node:module';
const { toAnchorCaptions } = createRequire(import.meta.url)(`${WT}/packages/edit-store/lib/index.js`);
const root = process.argv[2];
const { readRenderEdit } = await import(pathToFileURL(`${WT}/packages/render-cut/src/internal-render.mjs`));
const parsed = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
const capRoot = JSON.parse(await readFile(join(root, 'captions.json'), 'utf8'));
const norm = parsed?.version === 2 && parsed.sources === undefined ? { ...parsed, sources: [] } : parsed;
const edit = readRenderEdit(norm, join(root, '.akari', 'render-tmp'), { captions: toAnchorCaptions(capRoot) }).edit;
const planned = await rc.loadCaptions(root, edit);
const overlays = await rc.loadOverlays(root, edit);
const r = evaluateGpuEligibility({ edit: { ...edit, overlays }, captions: planned.captions,
  defaultTextStyle: planned.defaultTextStyle, emphasisWords: planned.emphasisWords });
const bad = r.entries.filter(e => e.classification === 'unsupported' || e.classification === 'degraded');
console.log(JSON.stringify({ eligible: r.eligible, summary: r.summary, entries: r.entries.length, bad }, null, 1));
