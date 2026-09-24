import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NarrationCli } from '../../lib/node/narration-engines.js';

test('narration RPC は Electron node モードで CLI を呼び、鍵を返さず状態と操作を渡す', async () => {
    const calls = [];
    const spawnImpl = (command, args, options) => {
        calls.push([command, args, options]);
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        queueMicrotask(() => {
            child.stdout.emit('data', Buffer.from(JSON.stringify(args.includes('engines')
                ? { engines: [{ id: 'voicevox', availability: { state: 'needs', detail: { running: false, app_found: true } } }] }
                : { status: 'ok' })));
            child.emit('close', 0);
        });
        return child;
    };
    const cli = new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs', FAL_KEY: 'never-expose' }, spawnImpl });
    const list = await cli.narrationEngines('http://127.0.0.1:4567');
    assert.equal(list.engines[0].availability.detail.app_found, true);
    assert.equal(JSON.stringify(list).includes('never-expose'), false);
    await cli.startNarrationEngine('voicevox');
    await cli.stopNarrationEngine('voicevox');
    assert.deepEqual(calls.filter(([, args]) => args[1] === 'narration').map(([, args]) => args.slice(2)), [
        ['engines', '--irodori-url', 'http://127.0.0.1:4567', '--json'], ['start', '--engine', 'voicevox', '--json'], ['stop', '--engine', 'voicevox', '--json']
    ]);
    assert.ok(calls.filter(([, args]) => args[1] === 'narration').every(([, , options]) => options.env.ELECTRON_RUN_AS_NODE === '1'));
});

test('設定の Gemini 同意照合は 0.8 未満を拒否し、合格した一時録音を片付ける', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-gemini-consent-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    let score = 0.79;
    const spawnImpl = (_command, _args) => {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        queueMicrotask(() => { child.stdout.emit('data', Buffer.from(JSON.stringify({ pass: true,
            checks: { script: { ok: true, score } } }))); child.emit('close', 0); });
        return child;
    };
    const cli = new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' }, tempRoot: root, spawnImpl });
    const audio = Buffer.from('synthetic recording').toString('base64');
    await assert.rejects(() => cli.voiceCheckGeminiConsent(audio), /80% 未満/);
    score = 0.8;
    const accepted = await cli.voiceCheckGeminiConsent(audio);
    assert.equal(accepted.score, 0.8);
    await cli.voiceDiscardGeminiConsent(accepted.path);
    await assert.rejects(() => import('node:fs/promises').then(fs => fs.access(accepted.path)), /ENOENT/);
});

test('VOICEVOX 試聴は一時プロジェクトの wav を data URL にして片付ける', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-rpc-test-'));
    try {
        const cli = new NarrationCli({ tempRoot: scratch, env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' },
            spawnImpl: (command, args) => {
                const child = new EventEmitter();
                child.stdout = new EventEmitter();
                child.stderr = new EventEmitter();
                queueMicrotask(async () => {
                    const project = args[args.indexOf('--project') + 1];
                    await mkdir(join(project, 'out/narration'), { recursive: true });
                    await writeFile(join(project, 'out/narration/n-0001.wav'), Buffer.from('RIFFfake'));
                    child.stdout.emit('data', Buffer.from(JSON.stringify({ path: 'out/narration/n-0001.wav' })));
                    child.emit('close', 0);
                });
                return child;
            } });
        const url = await cli.previewVoicevox();
        assert.equal(url, `data:audio/wav;base64,${Buffer.from('RIFFfake').toString('base64')}`);
    } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('brew が存在して cask が無いときは追加探索せず公式サイト導線になる', async () => {
    const calls = [];
    const cli = new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' },
        spawnImpl: (command, args) => {
            calls.push([command, args]);
            const child = new EventEmitter();
            child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
            queueMicrotask(() => {
                if (args[1] === 'narration') child.stdout.emit('data', Buffer.from(JSON.stringify({ engines: [] })));
                child.emit('close', command === 'brew' ? 1 : 0);
            });
            return child;
        } });
    assert.equal((await cli.narrationEngines()).voicevoxCaskAvailable, false);
    assert.equal(calls.filter(([, args]) => args[0] === 'info').length, 1);
});

test('voice RPC は CLI の引数を渡し、fal は承認前に spawn しない', async () => {
    const calls = [];
    const cli = new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' }, resolveHome: () => '/fake/akari-home', spawnImpl: (_command, args) => {
        calls.push(args.slice(1));
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        queueMicrotask(() => { child.stdout.emit('data', Buffer.from(JSON.stringify(args.includes('profiles') ? { profiles: [{ id: 'owner-ja', avatar: null, legacy: true }] } : { status: 'ok' }))); child.emit('close', 0); });
        return child;
    } });
    await assert.rejects(cli.voiceCopy({ profile: 'p', engine: 'fal-qwen3' }), /費用承認/u);
    assert.equal(calls.length, 0);
    await cli.voiceProfiles(); await cli.voiceRename('p', '新名');
    await cli.voiceCopy({ profile: 'p', engine: 'fal-qwen3', approved: true });
    await cli.voiceMigrateLegacy('owner-ja'); await cli.voiceDelete('p');
    assert.deepEqual(calls.map(args => args.slice(0, 2)), [
        ['voice', 'profiles'], ['voice', 'rename'], ['voice', 'copy'], ['voice', 'profiles'], ['voice', 'migrate-legacy'], ['voice', 'delete']
    ]);
    assert.ok(calls[2].includes('--yes'));
});

test('CLI の空 stdout・非ゼロ終了は stderr で reject し、成功時の不正 JSON も reject', async () => {
    const fake = (code, stdout, stderr) => new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' },
        spawnImpl: () => {
            const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
            queueMicrotask(() => {
                if (stdout) child.stdout.emit('data', Buffer.from(stdout));
                if (stderr) child.stderr.emit('data', Buffer.from(stderr));
                child.emit('close', code);
            });
            return child;
        } });
    await assert.rejects(fake(2, '', 'エンジンを起動できません').startNarrationEngine('voicevox'), /エンジンを起動できません/u);
    await assert.rejects(fake(0, 'not-json', '').stopNarrationEngine('voicevox'), /応答を読み取れません/u);
});

test('移行 RPC は creator-root 由来の HOME にある唯一のアバターを選ぶ', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-voice-migrate-test-'));
    const calls = [];
    try {
        await mkdir(join(scratch, 'avatars', 'sample'), { recursive: true });
        await writeFile(join(scratch, 'avatars', 'sample', 'avatar.json'), JSON.stringify({ id: 'sample', display_name: 'サンプル' }));
        const cli = new NarrationCli({ env: { AKARI_GENERATE_CLI: '/fake/akari.mjs' }, resolveHome: () => scratch,
            spawnImpl: (_command, args) => {
                calls.push(args);
                const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
                queueMicrotask(() => {
                    child.stdout.emit('data', Buffer.from(JSON.stringify(args.includes('profiles')
                        ? { profiles: [{ id: 'owner-ja', avatar: null, legacy: true }] } : { status: 'ok' })));
                    child.emit('close', 0);
                });
                return child;
            } });
        assert.deepEqual(await cli.voiceAvatars(), { avatars: [{ id: 'sample', displayName: 'サンプル' }] });
        await cli.voiceMigrateLegacy('owner-ja');
        assert.deepEqual(calls.at(-1).slice(1), ['voice', 'migrate-legacy', '--profile', 'owner-ja', '--avatar', 'sample', '--json']);
    } finally { await rm(scratch, { recursive: true, force: true }); }
});
