#!/usr/bin/env node
// L1 の作業用フォルダを作る。
//   <workspace>/project  = tight-bounds-fixtures.mjs の断片 5 枚を 4 秒ずつ順に並べたプロジェクト（出力 640×360・1 トラック）
//   <workspace>/sample   = 同梱のオンボーディングのサンプル（お手本の最終段 = HTML 断片 9 本）
// （シェルのタイムラインは起動時に開いたプロジェクトを映すので、run F は project・run S は sample を開いて起動する）
// usage: prepare-fixture.mjs <workspace>   （先に apps/shell の build:ext が要る = akari-surfaces/lib）
import { cp, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const repo = path.resolve(process.env.AKARI_REPO_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..'));
const { SHELL_TIGHT_FRAGMENTS, SHELL_TIGHT_PROJECTS } = await import(pathToFileURL(path.join(repo,
  'packages/overlay-runtime/test-harness/fixtures/tight-bounds-fixtures.mjs')).href);
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
const sample = path.join(repo, 'apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01');
const surfaces = path.join(repo, 'apps/shell/extensions/akari-surfaces/lib');
const { AkariOnboardingServiceImpl } = await import(pathToFileURL(path.join(surfaces, 'node/onboarding-service.js')).href);
const { splitOnboardingTokens } = await import(pathToFileURL(path.join(surfaces, 'onboarding/model.js')).href);

const project = path.join(workspace, 'sample');
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
await mkdir(path.join(project, '.akari'), { recursive: true });
await copyFile(path.join(sample, 'clip.mp4'), path.join(project, 'assets', 'サンプル動画.mp4'));
await writeFile(path.join(project, 'edit.json'), '{}');
await writeFile(path.join(project, 'review.json'), '{"version":0,"annotations":[]}\n');
const uri = pathToFileURL(project).toString();
const service = new AkariOnboardingServiceImpl();
// 利用者の ~/.akari の進み具合は読まない（このプロジェクトでお手本が有効、とだけ答える）。
service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, imported: true, exampleActive: true });
const transcript = JSON.parse(await readFile(path.join(sample, 'transcript.json'), 'utf8'));
const segments = splitOnboardingTokens(transcript.tokens.items);
await service.writeExample(uri, path.join(sample, 'clip.mp4'), segments, segments.length, true, { stage: 8 });
const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const html = edit.tracks.flatMap(track => track.items.filter(item => item.source?.kind === 'html').map(item => item.id));
if (html.length !== 9) throw new Error(`unexpected sample items: ${html.join(', ')}`);

const fixtures = path.join(workspace, 'project');
await cp(path.join(repo, 'templates/project-default'), fixtures, { recursive: true });
await mkdir(path.join(fixtures, 'overlays'), { recursive: true });
const items = [];
for (const { id, fragment } of Object.values(SHELL_TIGHT_PROJECTS)) {
  await writeFile(path.join(fixtures, 'overlays', `${id}.html`), SHELL_TIGHT_FRAGMENTS[fragment]);
  items.push({ id, at: items.length * 120, duration: 120, source: { kind: 'html', path: `overlays/${id}.html` } });
}
const doc = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'visual-1', lane: 'visual', items }] };
await writeFile(path.join(fixtures, 'edit.json'), JSON.stringify(doc, null, 2) + '\n');
await writeFile(path.join(fixtures, 'review.json'), '{"version":0,"annotations":[]}\n');
console.log(workspace);
