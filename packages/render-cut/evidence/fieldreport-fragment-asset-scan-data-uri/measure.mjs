import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFragmentAssetReferences } from '../../src/fragment-assets.mjs';
import { lintProject } from '../../../edit-lint/src/edit-lint.mjs';
import { projectPreviewEdit } from '../../../preview-server/src/preview-edit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, 'fixture');
const edit = readFileSync(join(project, 'edit.json'), 'utf8');
const html = readFileSync(join(project, 'overlays/fragment.html'), 'utf8');
const references = extractFragmentAssetReferences(html, 'overlays/fragment.html');
const lint = await lintProject(project, { writeReports: false });
const preview = projectPreviewEdit(edit, join(project, '.akari/preview-projection'), project);
let shell;
try {
  const require = createRequire(import.meta.url);
  const { rewritePreviewFragmentAssets } = require('../../../../apps/shell/extensions/akari-preview/lib/node/fragment-assets.js');
  let streams = 0;
  const result = await rewritePreviewFragmentAssets(html, {
    projectRoot: project, htmlPath: 'overlays/fragment.html', overlayId: 'neutral-card',
  }, async () => ({ id: `asset-${++streams}`, url: `/stream/${streams}` }));
  shell = { streams: result.streams.length, warnings: result.warnings.map(sanitize), ghostUrlRewritten: result.html.includes('/stream/') && !result.html.includes('url(ghost.png)') };
} catch (error) {
  shell = { unavailable: sanitize(String(error)) };
}
const capture = spawnSync(process.execPath, [resolve(here, '../../../akari-launcher/bin/akari.mjs'), 'capture', '-p', project, '-t', '0.1', '--engine', 'osr', '--out', join(here, `capture-${process.argv[2]}`)], { encoding: 'utf8' });
const record = {
  phase: process.argv[2],
  sharedScanner: references.map(({ role, attribute, raw, path }) => ({ role, attribute, raw, path })),
  editLint: { assetFindings: lint.findings.filter(f => f.check.startsWith('overlay-fragment-asset-')).map(f => ({ check: f.check, message: sanitize(f.message) })) },
  previewServer: { warnings: (preview.frameEngine?.warnings ?? []).map(sanitize), ghostUrlRewritten: preview.overlays[0]?.html.includes('/overlays/ghost.png') ?? false },
  shell,
  capture: { exitCode: capture.status, stdout: sanitize(capture.stdout ?? ''), stderr: sanitize(capture.stderr ?? '') },
};
writeFileSync(join(here, `${process.argv[2]}.json`), JSON.stringify(record, null, 2) + '\n');

function sanitize(value) {
  return value.replaceAll(project, '<FIXTURE>').replaceAll(resolve(here, '../../../..'), '<WORKTREE>')
    .replace(/\/Users\/[^\s'"`]+/gu, '<LOCAL_PATH>');
}
