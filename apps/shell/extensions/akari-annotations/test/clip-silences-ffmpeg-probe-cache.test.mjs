import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('service.ts',
    readFileSync(new URL('../src/node/akari-annotations-service.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const service = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsServiceImpl');
const names = new Set(['clipSilenceFfmpegPromise', 'clipSilenceFfmpegMissingUntil',
    'resolveClipSilenceFfmpeg', 'getClipSilences']);
const members = service.members.filter(member => names.has(member.name?.getText(source)));
assert.equal(members.length, names.size);
const code = ts.transpileModule(`class Harness { ${members.map(member => member.getText(source)).join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;

async function fixture(t, { env = {}, onPath = true, packaged = false } = {}) {
    const root = await fs.mkdtemp(join(tmpdir(), 'clip-silences-probe-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const project = join(root, 'project');
    await fs.mkdir(project);
    const videos = [1, 2, 3].map(index => join(root, `video-${index}.mp4`));
    for (const video of videos) await fs.writeFile(video, '');
    const packagedPath = packaged
        ? join(root, 'media-bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : undefined;
    if (packagedPath) {
        await fs.mkdir(dirname(packagedPath));
        await fs.writeFile(packagedPath, '');
    }

    let now = 1_000;
    let probeCalls = 0;
    const testProcess = { env, resourcesPath: packaged ? root : undefined,
        platform: process.platform, pid: process.pid };
    class Clock extends Date { static now() { return now; } }
    const execFileAsync = async (command, args) => {
        if (command === 'ffmpeg' && args.length === 1 && args[0] === '-version') {
            probeCalls++;
            await Promise.resolve();
            if (!onPath) throw new Error('ffmpeg is not on PATH');
            return { stdout: 'ffmpeg version test', stderr: '' };
        }
        return { stdout: '', stderr: '' };
    };
    const Harness = new Function('fs', 'join', 'dirname', 'relative', 'sep', 'isAbsolute',
        'process', 'Date', 'execFileAsync', 'parseSilenceDetectOutput',
        'CLIP_SILENCE_NOISE_DB', 'CLIP_SILENCE_MIN_SEC', code + '\nreturn Harness;')(
        fs, join, dirname, relative, sep, isAbsolute, testProcess, Clock, execFileAsync,
        () => [], -35, 0.3);
    const instance = new Harness();
    instance.fsPath = uri => uri;
    instance.resolveMediaUri = async (_project, videoUri) => videoUri;
    const requests = videos.map(videoUri => ({ projectRootUri: project, videoUri }));
    return {
        instance, requests, packagedPath,
        get probeCalls() { return probeCalls; },
        advance(ms) { now += ms; },
    };
}

test('同時を含む 3 回の無音解析で PATH の ffmpeg を 1 回だけ調べる', async t => {
    const f = await fixture(t);
    const first = await Promise.all([
        f.instance.getClipSilences(f.requests[0]), f.instance.getClipSilences(f.requests[1]),
    ]);
    const third = await f.instance.getClipSilences(f.requests[2]);
    assert.deepEqual([...first, third].map(result => result.status), ['ready', 'ready', 'ready']);
    assert.equal(f.probeCalls, 1);
});

test('AKARI_FFMPEG_BIN があれば PATH の調査を行わない', async t => {
    const f = await fixture(t, { env: { AKARI_FFMPEG_BIN: 'custom-ffmpeg' } });
    await Promise.all([f.instance.getClipSilences(f.requests[0]), f.instance.getClipSilences(f.requests[1])]);
    assert.equal((await f.instance.getClipSilences(f.requests[2])).status, 'ready');
    assert.equal(f.probeCalls, 0);
});

test('見つからない結果は 30 秒間共有し、その後に調べ直す', async t => {
    const f = await fixture(t, { onPath: false });
    const first = await Promise.all([
        f.instance.getClipSilences(f.requests[0]), f.instance.getClipSilences(f.requests[1]),
    ]);
    const third = await f.instance.getClipSilences(f.requests[2]);
    assert.deepEqual([...first, third].map(result => result.reason),
        ['ffmpeg-not-found', 'ffmpeg-not-found', 'ffmpeg-not-found']);
    assert.equal(f.probeCalls, 1);
    f.advance(29_999);
    assert.equal((await f.instance.getClipSilences(f.requests[0])).reason, 'ffmpeg-not-found');
    assert.equal(f.probeCalls, 1);
    f.advance(1);
    assert.equal((await f.instance.getClipSilences(f.requests[0])).reason, 'ffmpeg-not-found');
    assert.equal(f.probeCalls, 2);
});

test('PATH に無ければ packaged の ffmpeg を使う', async t => {
    const f = await fixture(t, { onPath: false, packaged: true });
    assert.equal((await f.instance.getClipSilences(f.requests[0])).status, 'ready');
    assert.equal(await f.instance.resolveClipSilenceFfmpeg(), f.packagedPath);
    assert.equal(f.probeCalls, 1);
});
