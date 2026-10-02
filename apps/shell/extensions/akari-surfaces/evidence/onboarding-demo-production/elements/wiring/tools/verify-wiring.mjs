// 配線の検証（ラッパー側の道具・製品コードではない）
// 使い方: node verify-wiring.mjs <root>   （root は空の隔離ディレクトリ。AKARI_HOME も root 配下に向ける）
// 1) 実物の AkariOnboardingServiceImpl（lib ビルド）で library を作り、サンプルを取り込み（sidecar も作る）
// 2) 作業ログと同じ順（本編 → 字幕 1..22 → stage 1..8）で writeExample を呼び、各段で edit-lint（lintProject）
// 3) 最後の edit.json / captions.json を記録
import { copyFile, cp, mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const WT = '<WORKTREE>';
const EXT = `${WT}/apps/shell/extensions/akari-surfaces`;
const { AkariOnboardingServiceImpl } = await import(pathToFileURL(`${EXT}/lib/node/onboarding-service.js`).href);
const { splitOnboardingTokens } = await import(pathToFileURL(`${EXT}/lib/onboarding/model.js`).href);
const { lintProject } = await import(pathToFileURL(`${WT}/packages/edit-lint/src/edit-lint.mjs`).href);

const root = process.argv[2];
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const service = new AkariOnboardingServiceImpl();
const library = await service.ensureSample(root);
const project = join(root, 'project');
await mkdir(join(project, 'assets'), { recursive: true });
await mkdir(join(project, '.akari'), { recursive: true });
await writeFile(join(project, 'edit.json'), JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [], tracks: [] }, null, 2) + '\n');
const projectUri = pathToFileURL(project).toString();
const sourcePath = join(library, 'clip.mp4');
let state = { schema: 1, step: 'work', sub: 0, projectUri, imported: true };
service.load = async () => state;
service.projectService = { recordDroppedAssets: async (_uri, files) => {
    await copyFile(files[0].sourcePath, join(project, 'assets', files[0].name));
    return [{ success: true, assetPath: `assets/${files[0].name}` }];
} };
await service.importSample(projectUri, sourcePath);
const transcript = JSON.parse(await readFile(join(library, 'transcript.json'), 'utf8'));
const segments = splitOnboardingTokens(transcript.tokens.items);
const report = { library: await readdir(library, { recursive: true }), stages: [] };
const snapshot = async label => {
    const edit = JSON.parse(await readFile(join(project, 'edit.json'), 'utf8'));
    const captions = JSON.parse(await readFile(join(project, 'captions.json'), 'utf8').catch(() => '{"captions":[]}'));
    const lint = await lintProject(project);
    const files = (await readdir(project, { recursive: true })).filter(n => !n.startsWith('.akari')).map(n => n.replaceAll('\\', '/'));
    report.stages.push({ label, lint: lint.verdict, errors: lint.findings.filter(f => f.severity === 'error').map(f => f.message),
        warnings: lint.findings.filter(f => f.severity === 'warning').length,
        tracks: edit.tracks.map(t => `${t.id}[${(t.items || []).map(i => i.id).join(',')}]`),
        sources: edit.sources.map(s => s.id), files: files.filter(n => /overlays\/|assets\/onboarding/.test(n)).sort(),
        captions: captions.captions.length, runs: captions.captions.filter(c => c.runs?.length).map(c => c.id),
        karaoke: captions.captions.filter(c => c.style === 'karaoke').map(c => c.id) });
};
await service.writeExample(projectUri, sourcePath, segments, 0, false);
await snapshot('count-0');
for (let count = 1; count <= segments.length; count++) await service.writeExample(projectUri, sourcePath, segments, count, false);
await snapshot('captions-22');
for (let stage = 1; stage <= 8; stage++) {
    await service.writeExample(projectUri, sourcePath, segments, segments.length, true, { stage });
    await snapshot(`stage-${stage}`);
}
await writeFile(join(root, 'stages.json'), JSON.stringify(report, null, 1));
for (const s of report.stages) console.log(s.label, s.lint, s.errors.length, 'warn', s.warnings, s.tracks.join(' | '));
console.log('project', project);
