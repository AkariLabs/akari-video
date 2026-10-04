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
const names = new Set(['clipSilenceFfmpegPromise', 'clipSilenceFfmpegMissingUntil', 'clipSilenceResults',
    'resolveClipSilenceFfmpeg', 'getClipSilences']);
const members = service.members.filter(member => names.has(member.name?.getText(source)));
assert.equal(members.length, names.size);
const code = ts.transpileModule(`class Harness { ${members.map(member => member.getText(source)).join('\n')} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;

async function fixture(t, { extension = '.mp3', failExtraction = false, override = true } = {}) {
    const root = await fs.mkdtemp(join(tmpdir(), 'clip-silences-no-respawn-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const media = join(root, `source${extension}`);
    await fs.writeFile(media, '');
    const calls = [];
    const execFileAsync = async (command, args) => {
        calls.push({ command, args });
        if (args[0] === '-version') return { stdout: 'ffmpeg version test', stderr: '' };
        if (failExtraction) throw new Error('no audio stream');
        return { stdout: '', stderr: '' };
    };
    const testProcess = { env: override ? { AKARI_FFMPEG_BIN: 'fixture-ffmpeg' } : {},
        platform: process.platform, pid: process.pid };
    const Harness = new Function('fs', 'join', 'dirname', 'relative', 'sep', 'isAbsolute',
        'process', 'Date', 'execFileAsync', 'parseSilenceDetectOutput',
        'CLIP_SILENCE_NOISE_DB', 'CLIP_SILENCE_MIN_SEC', code + '\nreturn Harness;')(
        fs, join, dirname, relative, sep, isAbsolute, testProcess, Date, execFileAsync,
        () => [], -35, 0.3);
    const instance = new Harness();
    instance.fsPath = uri => uri;
    instance.resolveMediaUri = async () => media;
    return {
        instance, media, calls,
        request: { projectRootUri: root, videoUri: media },
        get extractionCalls() { return calls.filter(call => call.args.includes('-i')).length; },
    };
}

test('静止画は ffmpeg の探索も解析も行わない', async t => {
    const f = await fixture(t, { extension: '.PNG', override: false });
    assert.deepEqual(await f.instance.getClipSilences(f.request),
        { status: 'unavailable', reason: 'extraction-failed' });
    assert.equal(f.calls.length, 0);
});

test('解析が失敗しても、同時呼び出しと再呼び出しで ffmpeg を再起動しない', async t => {
    const f = await fixture(t, { failExtraction: true });
    const first = await Promise.all([
        f.instance.getClipSilences(f.request), f.instance.getClipSilences(f.request),
    ]);
    const third = await f.instance.getClipSilences(f.request);
    assert.deepEqual([...first, third].map(result => result.reason),
        ['extraction-failed', 'extraction-failed', 'extraction-failed']);
    assert.equal(f.extractionCalls, 1);
});

test('解析が成功しても、同じ source の ffmpeg 実行は 1 回', async t => {
    const f = await fixture(t);
    const first = await Promise.all([
        f.instance.getClipSilences(f.request), f.instance.getClipSilences(f.request),
    ]);
    const third = await f.instance.getClipSilences(f.request);
    assert.deepEqual([...first, third].map(result => result.status), ['ready', 'ready', 'ready']);
    assert.equal(f.extractionCalls, 1);
});

test('source の mtime が変わると再解析する', async t => {
    const f = await fixture(t);
    assert.equal((await f.instance.getClipSilences(f.request)).status, 'ready');
    const changed = new Date(Date.now() + 60_000);
    await fs.utimes(f.media, changed, changed);
    assert.equal((await f.instance.getClipSilences(f.request)).status, 'ready');
    assert.equal(f.extractionCalls, 2);
});
