#!/usr/bin/env node
// 同梱サンプルのプロジェクトを、製品のオンボーディングのコード（writeExample・段階 8 = お手本の完成形）で作る。
import { cp, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , workspaceArg, variant = 'plain'] = process.argv;
if (!workspaceArg) throw new Error('usage: prepare-sample.mjs <workspace> [plain|elements]');
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = process.env.AKARI_REPO_DIR ? path.resolve(process.env.AKARI_REPO_DIR) : path.resolve(here, '../../../../../../..');
const surfaces = path.join(repo, 'apps/shell/extensions/akari-surfaces/lib');
const { AkariOnboardingServiceImpl } = await import(pathToFileURL(path.join(surfaces, 'node/onboarding-service.js')).href);
const { splitOnboardingTokens } = await import(pathToFileURL(path.join(surfaces, 'onboarding/model.js')).href);
const sample = path.join(repo, 'apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01');

await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
const project = path.join(workspace, 'project');
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
await mkdir(path.join(project, '.akari'), { recursive: true });
await copyFile(path.join(sample, 'clip.mp4'), path.join(project, 'assets', 'サンプル動画.mp4'));
await writeFile(path.join(project, 'edit.json'), '{}');
await writeFile(path.join(project, 'review.json'), '{"version":0,"annotations":[]}\n');
const uri = pathToFileURL(project).toString();
const service = new AkariOnboardingServiceImpl();
service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, imported: true, exampleActive: true });
const segments = splitOnboardingTokens(JSON.parse(await readFile(path.join(sample, 'transcript.json'), 'utf8')).tokens.items);
await service.writeExample(uri, path.join(sample, 'clip.mp4'), segments, segments.length, true, { stage: 8 });

const editPath = path.join(project, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
const htmlItems = edit.tracks.flatMap(track => track.items ?? []).filter(item => item.source?.kind === 'html');
if (variant === 'elements') {
  // E2 / E3 の要素の上書き（source.elements）を持つアイテム。値はプレビューの許可リストにある形だけ。
  const overrides = process.env.AKARI_FTW_ELEMENTS ? JSON.parse(process.env.AKARI_FTW_ELEMENTS) : {
    'demo-title': { '.demo-title__lead[0]': { style: { translate: '12px 6px' } } },
    'demo-bgm-chip': { '.demo-bgm__label[0]': { style: { rotate: '8deg' } } },
  };
  for (const item of htmlItems) if (overrides[item.id]) item.source.elements = overrides[item.id];
  await writeFile(editPath, JSON.stringify(edit, null, 2) + '\n');
}
for (const item of htmlItems) {
  const bundled = await readFile(path.join(sample, item.source.path));
  const copied = await readFile(path.join(project, item.source.path));
  if (!bundled.equals(copied)) throw new Error(`sample fragment differs from the bundled bytes: ${item.source.path}`);
}
console.log(JSON.stringify({ project, variant, fps: edit.output.fps,
  items: htmlItems.map(item => ({ id: item.id, at: item.at, duration: item.duration, path: item.source.path,
    elements: item.source.elements ?? null })) }));
