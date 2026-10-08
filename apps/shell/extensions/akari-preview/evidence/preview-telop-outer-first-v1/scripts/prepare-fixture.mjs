#!/usr/bin/env node
// L1 の作業用フォルダを作る。
//   <workspace>/project = テンプレのテロップ 2〜3 種 + テンプレでない HTML 1 本を同じ時間に並べたプロジェクト（出力 1280×720・30fps・10 秒）
//     - ov-plate       : ソースが assets/overlay/telop-l1-plate/fragment.html（= ライブラリのテロップを置いたときの形）。座布団の板 + アイコン + 文字
//     - telop-l1-name  : id が telop-*（ソースは overlays/name-card.html）。板 + 名前 + 肩書き
//     - ov-lib         : 利用者のライブラリにテロップ telop-base-question-label-tab があるときだけ。ライブラリから置いたときと同じ
//                        assets/overlay/<id>-edit-<item>-<hash>/fragment.html の形へ写す（素材の実体はリポに入れない）
//     - ov-card        : テンプレでない HTML（overlays/card.html）。板 + アイコン + 文字（テロップと同じ形・判定だけが違う）
//   <workspace>/sample  = 同梱のオンボーディングのサンプル（お手本の最終段 = HTML 断片 9 本・demo-title / demo-diagram を含む）
// usage: prepare-fixture.mjs <workspace>   （先に apps/shell の build:ext が要る = akari-surfaces/lib）
//   AKARI_PTOF_LIBRARY = ライブラリの根（既定 ~/Akari/library）。無ければ ov-lib を置かない
import { access, cp, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceArg = process.argv[2];
if (!workspaceArg) throw new Error('usage: prepare-fixture.mjs <workspace>');
const repo = path.resolve(process.env.AKARI_REPO_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..'));
await mkdir(workspaceArg, { recursive: true });
const workspace = await realpath(workspaceArg);

// ---- run S: 同梱のサンプル ----
const sample = path.join(repo, 'apps/shell/resources/onboarding-sample/talkinghead-desk-ja-01');
const surfaces = path.join(repo, 'apps/shell/extensions/akari-surfaces/lib');
const { AkariOnboardingServiceImpl } = await import(pathToFileURL(path.join(surfaces, 'node/onboarding-service.js')).href);
const { splitOnboardingTokens } = await import(pathToFileURL(path.join(surfaces, 'onboarding/model.js')).href);
const sampleProject = path.join(workspace, 'sample');
await cp(path.join(repo, 'templates/project-default'), sampleProject, { recursive: true });
await mkdir(path.join(sampleProject, 'assets'), { recursive: true });
await mkdir(path.join(sampleProject, '.akari'), { recursive: true });
await copyFile(path.join(sample, 'clip.mp4'), path.join(sampleProject, 'assets', 'サンプル動画.mp4'));
await writeFile(path.join(sampleProject, 'edit.json'), '{}');
await writeFile(path.join(sampleProject, 'review.json'), '{"version":0,"annotations":[]}\n');
const uri = pathToFileURL(sampleProject).toString();
const service = new AkariOnboardingServiceImpl();
// 利用者の ~/.akari の進み具合は読まない（このプロジェクトでお手本が有効、とだけ答える）。
service.load = async () => ({ schema: 1, step: 'work', sub: 0, projectUri: uri, imported: true, exampleActive: true });
const transcript = JSON.parse(await readFile(path.join(sample, 'transcript.json'), 'utf8'));
const segments = splitOnboardingTokens(transcript.tokens.items);
await service.writeExample(uri, path.join(sample, 'clip.mp4'), segments, segments.length, true, { stage: 8 });
const sampleEdit = JSON.parse(await readFile(path.join(sampleProject, 'edit.json'), 'utf8'));
const html = sampleEdit.tracks.flatMap(track => track.items.filter(item => item.source?.kind === 'html').map(item => item.id));
for (const id of ['demo-title', 'demo-diagram']) if (!html.includes(id)) throw new Error(`sample item missing: ${id} (${html.join(', ')})`);

// ---- run T: テロップの fixture ----
const PLATE = `<div class="tp" style="position:absolute;inset:0">
  <div class="tp__plate" style="position:absolute;left:80px;top:540px;width:520px;height:120px;background:#173a8c;border-radius:16px;box-shadow:0 6px 0 #0b1d47">
    <div class="tp__icon" style="position:absolute;left:24px;top:30px;width:60px;height:60px;border-radius:50%;background:#ffd23f"></div>
    <div class="tp__text" style="position:absolute;left:110px;top:28px;font:700 52px/64px sans-serif;color:#fff;white-space:nowrap">テロップ見出し</div>
  </div>
</div>
`;
const NAME = `<div class="nc" style="position:absolute;inset:0">
  <div class="nc__plate" style="position:absolute;left:80px;top:60px;width:440px;height:130px;background:#ffffff;border:6px solid #e8590c;border-radius:12px">
    <div class="nc__name" style="position:absolute;left:30px;top:14px;font:800 48px/58px sans-serif;color:#3a1500;white-space:nowrap">中島 太郎</div>
    <div class="nc__role" style="position:absolute;left:32px;top:76px;font:500 26px/32px sans-serif;color:#8f3a0a;white-space:nowrap">AKARI Video 開発</div>
  </div>
</div>
`;
const CARD = `<div class="oc" style="position:absolute;inset:0">
  <div class="oc__plate" style="position:absolute;left:760px;top:60px;width:440px;height:120px;background:#2d6a4f;border-radius:16px">
    <div class="oc__icon" style="position:absolute;left:24px;top:30px;width:60px;height:60px;border-radius:12px;background:#b7e4c7"></div>
    <div class="oc__text" style="position:absolute;left:110px;top:28px;font:700 52px/64px sans-serif;color:#fff;white-space:nowrap">ふつうの札</div>
  </div>
</div>
`;
const project = path.join(workspace, 'project');
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await mkdir(path.join(project, 'overlays'), { recursive: true });
const place = async (relative, text) => {
  await mkdir(path.dirname(path.join(project, relative)), { recursive: true });
  await writeFile(path.join(project, relative), text);
};
await place('assets/overlay/telop-l1-plate/fragment.html', PLATE);
await place('overlays/name-card.html', NAME);
await place('overlays/card.html', CARD);
const item = (id, sourcePath, extra = {}) => ({ id, at: 0, duration: 300, ...extra, source: { kind: 'html', path: sourcePath } });
const tracks = [
  { id: 'visual-1', lane: 'visual', items: [item('ov-plate', 'assets/overlay/telop-l1-plate/fragment.html')] },
  { id: 'visual-2', lane: 'visual', items: [item('telop-l1-name', 'overlays/name-card.html')] },
  { id: 'visual-3', lane: 'visual', items: [item('ov-card', 'overlays/card.html')] },
];
const library = process.env.AKARI_PTOF_LIBRARY ?? path.join(os.homedir(), 'Akari/library');
const libTelop = path.join(library, 'overlay/telop-base-question-label-tab');
let libraryTelop = false;
try {
  await access(path.join(libTelop, 'fragment.html'));
  const relative = 'assets/overlay/telop-base-question-label-tab-edit-ov-lib-l1/fragment.html';
  await place(relative, await readFile(path.join(libTelop, 'fragment.html'), 'utf8'));
  tracks.push({ id: 'visual-4', lane: 'visual', items: [{ ...item('ov-lib', relative),
    transform: { x: 280, y: 60, scale: 0.6, rotate: 0 },
    source: { kind: 'html', path: relative, params: { text: 'L1 の設問' } } }] });
  libraryTelop = true;
} catch { /* ライブラリが無い環境では 2 種（ov-plate・telop-l1-name）で回す */ }
const doc = { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [], tracks };
await writeFile(path.join(project, 'edit.json'), JSON.stringify(doc, null, 2) + '\n');
await writeFile(path.join(project, 'review.json'), '{"version":0,"annotations":[]}\n');
console.log(JSON.stringify({ workspace, libraryTelop }));
