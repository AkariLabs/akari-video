#!/usr/bin/env node
// 同梱のオンボーディングのサンプル（talkinghead-desk-ja-01・お手本の最終段 = stage 8）を作業用フォルダへ作る。
// サンプルの断片は同梱のものをそのまま複写する（オンボーディングの writeExample と同じ経路）。
// usage: prepare-fixture.mjs <workspace>   （先に apps/shell の build:ext が要る = akari-surfaces/lib）
import { cp, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const repo = path.resolve(process.env.AKARI_REPO_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..'));
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);
const sample = path.join(repo, 'apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01');
const surfaces = path.join(repo, 'apps/shell/extensions/akari-surfaces/lib');
const { AkariOnboardingServiceImpl } = await import(pathToFileURL(path.join(surfaces, 'node/onboarding-service.js')).href);
const { splitOnboardingTokens } = await import(pathToFileURL(path.join(surfaces, 'onboarding/model.js')).href);

const project = path.join(workspace, 'project');
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
if (html.length !== 9 || !html.includes('demo-effects')) throw new Error(`unexpected sample items: ${html.join(', ')}`);
console.log(project);
