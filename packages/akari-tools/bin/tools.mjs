#!/usr/bin/env node
import { t as toolsText } from '../../i18n/index.mjs';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isMainModule } from '../src/common/main-module.mjs';
import { whisperModelCandidates, isWhisperModelExcluded } from '../src/media/whisper-model-candidates.mjs';
import { WHISPER_MODEL, installWhisperModel } from '../src/media/whisper-model.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const modelPins = [
    { file: 'wespeaker_en_voxceleb_resnet34_LM.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx', sha256: 'e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012', bytes: 26530550, license: 'CC-BY-4.0' },
    // releases は tar.bz2 のみ。Node 標準で展開できる同じ保守者の配布をコミット固定で使う。中の model.onnx と sha256 は同じ。
    { file: 'pyannote-segmentation-3.0.onnx', url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx', sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079', bytes: 5992913, license: 'MIT' },
    { file: 'silero_vad.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', bytes: 643854, license: 'MIT' }
];
const sherpaNode = { name: 'sherpa-onnx-node', version: '1.13.8', integrity: 'sha512-MsDMBdhLFTZ1GwvcGSSQhnS7g/EA8OMH6IYysCVUOM7j8Icty9KRc0E6YT1A5fWBsZwRfKOeh88QC95aRvS8ag==', bytes: 11954, unpackedBytes: 61221, required: 'addon.js' };
const onnxCommon = { name: 'onnxruntime-common', version: '1.30.0', integrity: 'sha512-7fdVWjAID1dVhH/G8qK3APARunV4VkBFoCQAP7qp4Wkab0mrorvmc+sqiT+mKXOzDqdjN5j+/Z9nb4gzNPWcyA==', bytes: 66795, unpackedBytes: 574567, required: 'dist/cjs/index.js' };
const onnxNode = { name: 'onnxruntime-node', version: '1.30.0', integrity: 'sha512-twhs1C2C/BFkz1yc5OY0KIU2GUq6DURO7hD4bx5Q2Qy3nAMJwRXW8xU3NVczE29VA9lolLOYepoD8fjTGOfIqw==', bytes: 113507888 };

export const VOICE_ENGINE_PINS = {
    models: modelPins,
    runtimes: {
        'win32-x64': [sherpaNode,
            { name: 'sherpa-onnx-win-x64', version: '1.13.8', integrity: 'sha512-oZF1c9VPOKtMwn83Bboc5XSWL+76BRoyB3eUuVnCknBKxwSULZU2Foia9VHWzU+n4I12rPsP6z6H9Rp1hD9o8g==', bytes: 8894875, unpackedBytes: 23453246, required: 'sherpa-onnx.node' },
            onnxCommon, { ...onnxNode, unpackedBytes: 67135952, required: 'bin/napi-v6/win32/x64/onnxruntime_binding.node', keep: 'bin/napi-v6/win32/x64/' }],
        'darwin-arm64': [sherpaNode,
            { name: 'sherpa-onnx-darwin-arm64', version: '1.13.8', integrity: 'sha512-FPNgJMgnWVl/KhRTIhG3KL3A4Om63Rn4YKXc9/uHY7SzLcvqLJLc/h7UBWJwduXvv7K18t5NpxHR6XgXn4sjWw==', bytes: 10047754, unpackedBytes: 34089738, required: 'sherpa-onnx.node' },
            onnxCommon, { ...onnxNode, unpackedBytes: 89506960, required: 'bin/napi-v6/darwin/arm64/onnxruntime_binding.node', keep: 'bin/napi-v6/darwin/arm64/' }],
        // 1.24 以降の npm 包に darwin/x64 の prebuilt が無いため onnxruntime-node は入れない。
        'darwin-x64': [sherpaNode,
            { name: 'sherpa-onnx-darwin-x64', version: '1.13.8', integrity: 'sha512-7BLRpjM6w4f9W46/nmkmq8lEKUayhebvcpslCVQ+6QN2uReYlZEMDZlSpXMjme+hUFrPfRz8P3UNq8ep/4d19g==', bytes: 11191481, unpackedBytes: 37678686, required: 'sherpa-onnx.node' }]
    }
};

export function resolveVoiceHome({ env = process.env, homeDir = homedir() } = {}) {
    return env.AKARI_VOICE_HOME || join(env.AKARI_HOME || join(homeDir, '.akari'), 'tools', 'voice');
}

export function voiceRuntimeKey(platform, arch) {
    const key = `${platform}-${arch}`;
    return Object.hasOwn(VOICE_ENGINE_PINS.runtimes, key) ? key : undefined;
}

function manifestFor(platform, arch, pins) {
    const packages = pins.runtimes[`${platform}-${arch}`];
    if (!packages) return undefined;
    return {
        version: 1,
        runtime: { platform, arch, packages: packages.map(({ name, version, integrity }) => ({ name, version, integrity })) },
        models: pins.models.map(({ file, url, sha256, bytes, license }) => ({ file, url, sha256, bytes, license }))
    };
}

export function expectedVoiceManifest(platform, arch) {
    return manifestFor(platform, arch, VOICE_ENGINE_PINS);
}

async function readManifest(voiceHome) {
    try { return JSON.parse(await fs.readFile(join(voiceHome, 'manifest.json'), 'utf8')); }
    catch { return undefined; }
}

function manifestMatches(actual, expected) {
    if (!actual || actual.version !== 1 || actual.runtime?.platform !== expected.runtime.platform || actual.runtime?.arch !== expected.runtime.arch) return false;
    const same = (a, b, keys) => Array.isArray(a) && a.length === b.length && a.every((item, index) => keys.every(key => item?.[key] === b[index][key]));
    return same(actual.runtime.packages, expected.runtime.packages, ['name', 'version', 'integrity']) && same(actual.models, expected.models, ['file', 'sha256']);
}

async function packagePresent(dir, pin) {
    try {
        const info = JSON.parse(await fs.readFile(join(dir, 'package.json'), 'utf8'));
        if (info.name !== pin.name || info.version !== pin.version) return false;
        return (await fs.stat(join(dir, pin.required))).isFile();
    } catch { return false; }
}

async function modelPresent(file, pin, hash = false) {
    try {
        const info = await fs.stat(file);
        if (!info.isFile() || info.size !== pin.bytes) return false;
        return !hash || createHash('sha256').update(await fs.readFile(file)).digest('hex') === pin.sha256;
    } catch { return false; }
}

export async function inspectVoiceEngine({ voiceHome = resolveVoiceHome(), platform = process.platform, arch = process.arch } = {}) {
    const key = voiceRuntimeKey(platform, arch);
    if (!key) return { state: 'unsupported', voiceHome, needs: [toolsText('tools.voice.cli.unsupportedNeed')] };
    const expected = expectedVoiceManifest(platform, arch);
    const actual = await readManifest(voiceHome);
    if (!actual) return { state: 'missing', voiceHome, needs: [toolsText('tools.voice.cli.notDownloadedNeed')] };
    if (!manifestMatches(actual, expected)) return { state: 'outdated', voiceHome, needs: [toolsText('tools.voice.cli.outdatedNeed')] };
    for (const pin of VOICE_ENGINE_PINS.runtimes[key]) {
        if (!await packagePresent(join(voiceHome, 'runtime', key, 'node_modules', pin.name), pin)) return { state: 'broken', voiceHome, needs: [toolsText('tools.voice.cli.missingFilesNeed')] };
    }
    for (const pin of VOICE_ENGINE_PINS.models) {
        if (!await modelPresent(join(voiceHome, 'models', pin.file), pin)) return { state: 'broken', voiceHome, needs: [toolsText('tools.voice.cli.missingFilesNeed')] };
    }
    return { state: 'ready', voiceHome, needs: [] };
}

async function nearestExisting(path) {
    let current = resolve(path);
    for (;;) {
        try { await fs.stat(current); return current; }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const parent = dirname(current);
            if (parent === current) throw error;
            current = parent;
        }
    }
}

function safeTarPath(value) {
    const name = value.replace(/\0.*$/, '').replace(/\/+$/, '');
    if (!name || name.includes('\\') || name.startsWith('/') || isAbsolute(name) || /^[A-Za-z]:/.test(name)) throw new Error(toolsText('tools.voice.cli.invalidTarPath'));
    const parts = name.split('/');
    if (parts.includes('..') || parts.includes('')) throw new Error(toolsText('tools.voice.cli.invalidTarPath'));
    return name;
}

function tarString(buffer, start, length) { return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/, ''); }
function tarNumber(buffer, start, length) { return parseInt(tarString(buffer, start, length).trim() || '0', 8); }
function paxPath(data) {
    let offset = 0; let path;
    while (offset < data.length) {
        const space = data.indexOf(32, offset);
        if (space < 0) throw new Error(toolsText('tools.voice.cli.invalidPax'));
        const length = Number(data.subarray(offset, space).toString());
        if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length) throw new Error(toolsText('tools.voice.cli.invalidPax'));
        const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
        if (record.startsWith('path=')) path = record.slice(5);
        offset += length;
    }
    return path;
}

async function unpackTarball(gzip, destination, pin) {
    const tar = gunzipSync(gzip);
    let offset = 0; let nextPath;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(byte => byte === 0)) break;
        const size = tarNumber(header, 124, 12);
        if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error(toolsText('tools.voice.cli.invalidTar'));
        const data = tar.subarray(offset + 512, offset + 512 + size);
        const type = String.fromCharCode(header[156] || 48);
        const raw = [tarString(header, 345, 155), tarString(header, 0, 100)].filter(Boolean).join('/');
        offset += 512 + Math.ceil(size / 512) * 512;
        if (type === 'x') { nextPath = paxPath(data); continue; }
        if (type === 'L') { nextPath = data.toString('utf8').replace(/\0.*$/, '').replace(/\n$/, ''); continue; }
        if (type === 'g') continue;
        const name = safeTarPath(nextPath || raw);
        nextPath = undefined;
        if (type !== '0') continue;
        if (!name.startsWith('package/')) throw new Error(toolsText('tools.voice.cli.invalidTarPlacement'));
        const relative = safeTarPath(name.slice('package/'.length));
        if (pin.keep && relative.startsWith('bin/napi-v6/') && !relative.startsWith(pin.keep)) continue;
        const target = join(destination, ...relative.split('/'));
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, data);
    }
    if (!await packagePresent(destination, pin)) throw new Error(toolsText('tools.voice.cli.incompletePackage'));
}

async function fetchBytes(fetchImpl, url, progress) {
    const response = await fetchImpl(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body?.getReader) {
        const bytes = Buffer.from(await response.arrayBuffer());
        progress(bytes.length);
        return bytes;
    }
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); length += value.length; progress(value.length);
    }
    return Buffer.concat(chunks, length);
}

async function writeManifest(voiceHome, manifest) {
    await fs.mkdir(voiceHome, { recursive: true });
    const temp = join(voiceHome, `manifest.json.tmp-${process.pid}`);
    try {
        await fs.writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`);
        await fs.rename(temp, join(voiceHome, 'manifest.json'));
    } finally { await fs.rm(temp, { force: true }); }
}

export async function installVoiceEngine({ voiceHome = resolveVoiceHome(), platform = process.platform, arch = process.arch,
    fetchImpl = fetch, statfs = fs.statfs, onProgress, pins = VOICE_ENGINE_PINS } = {}) {
    const key = `${platform}-${arch}`;
    const packages = pins.runtimes[key];
    if (!packages) return { outcome: 'unsupported', message: toolsText('tools.voice.cli.unsupportedPlatform', { platform: key }), fetched: [] };
    const expected = manifestFor(platform, arch, pins);
    const existing = await readManifest(voiceHome);
    const missingPackages = [];
    const missingModels = [];
    for (const pin of packages) if (!await packagePresent(join(voiceHome, 'runtime', key, 'node_modules', pin.name), pin)) missingPackages.push(pin);
    for (const pin of pins.models) if (!await modelPresent(join(voiceHome, 'models', pin.file), pin, true)) missingModels.push(pin);
    if (!missingPackages.length && !missingModels.length && manifestMatches(existing, expected)) {
        return { outcome: 'unchanged', message: toolsText('tools.voice.cli.alreadyReady'), fetched: [] };
    }
    const items = [...missingPackages.map(pin => ({ pin, kind: 'package' })), ...missingModels.map(pin => ({ pin, kind: 'model' }))];
    const fetched = [];
    const stage = join(voiceHome, `.staging-${process.pid}-${Date.now()}`);
    const backups = [];
    let committed = false;
    try {
        if (items.length) {
            const required = items.reduce((sum, { pin, kind }) => sum + (kind === 'package' ? pin.unpackedBytes : pin.bytes), 64 * 1024 * 1024);
            const space = await statfs(await nearestExisting(voiceHome));
            const available = Number(space.bavail) * Number(space.bsize);
            if (available < required) return { outcome: 'failed', message: toolsText('tools.voice.cli.notEnoughSpace', { megabytes: Math.ceil((required - available) / 1048576) }), fetched };
            await fs.mkdir(stage, { recursive: true });
        }
        const totalBytes = items.reduce((sum, { pin }) => sum + pin.bytes, 0);
        let downloadedBytes = 0;
        for (const [index, { pin, kind }] of items.entries()) {
            const name = kind === 'package' ? pin.name : pin.file;
            const url = kind === 'package' ? `https://registry.npmjs.org/${pin.name}/-/${pin.name}-${pin.version}.tgz` : pin.url;
            const report = delta => {
                downloadedBytes += delta;
                onProgress?.({ phase: toolsText('tools.voice.cli.downloading', { index: index + 1, count: items.length }), downloadedBytes, totalBytes, index: index + 1, count: items.length, name });
            };
            const bytes = await fetchBytes(fetchImpl, url, report);
            const actual = createHash(kind === 'package' ? 'sha512' : 'sha256').update(bytes).digest(kind === 'package' ? 'base64' : 'hex');
            const wanted = kind === 'package' ? pin.integrity.slice(7) : pin.sha256;
            if (actual !== wanted) throw new Error(`VERIFY:${name}`);
            if (kind === 'package') await unpackTarball(bytes, join(stage, 'runtime', key, 'node_modules', pin.name), pin);
            else {
                const target = join(stage, 'models', pin.file);
                await fs.mkdir(dirname(target), { recursive: true });
                await fs.writeFile(target, bytes);
            }
            fetched.push(name);
        }
        for (const { pin, kind } of items) {
            const relative = kind === 'package' ? join('runtime', key, 'node_modules', pin.name) : join('models', pin.file);
            const target = join(voiceHome, relative);
            const source = join(stage, relative);
            await fs.mkdir(dirname(target), { recursive: true });
            let backup;
            try {
                await fs.lstat(target);
                backup = `${target}.old-${process.pid}-${Date.now()}`;
                await fs.rename(target, backup);
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
            backups.push({ target, backup });
            await fs.rename(source, target);
        }
        const nodeModules = join(voiceHome, 'runtime', key, 'node_modules');
        for (const entry of await fs.readdir(nodeModules).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
            if (!packages.some(pin => pin.name === entry)) await fs.rm(join(nodeModules, entry), { recursive: true, force: true });
        }
        await writeManifest(voiceHome, expected);
        committed = true;
        return { outcome: 'installed', message: toolsText('tools.voice.cli.installed'), fetched };
    } catch (error) {
        const name = typeof error.message === 'string' && error.message.startsWith('VERIFY:') ? error.message.slice(7) : undefined;
        return { outcome: 'failed', message: name
            ? toolsText('tools.voice.cli.verifyFailed', { name })
            : toolsText('tools.voice.cli.downloadFailed'), fetched };
    } finally {
        if (!committed) for (const { target, backup } of backups.reverse()) {
            await fs.rm(target, { recursive: true, force: true });
            if (backup) await fs.rename(backup, target);
        }
        if (committed) for (const { backup } of backups) if (backup) await fs.rm(backup, { recursive: true, force: true });
        await fs.rm(stage, { recursive: true, force: true });
    }
}

export async function runToolsCli(argv, { env = process.env, homeDir = homedir(), stdout = process.stdout, stderr = process.stderr,
    fetchImpl = fetch, statfs = fs.statfs, platform = process.platform, arch = process.arch, pins = VOICE_ENGINE_PINS, whisperModel = WHISPER_MODEL } = {}) {
    const usage = toolsText('tools.whisper.cli.usage');
    if (argv.includes('--help')) { stdout.write(`${usage}\n`); return 0; }
    const [verb, subject, ...rest] = argv;
    if (!['install', 'status'].includes(verb) || !['voice', 'whisper'].includes(subject) || rest.some(value => value !== '--json')) {
        stderr.write(`${usage}\n`); return 2;
    }
    if (subject === 'whisper') return runWhisperCli(verb, rest.includes('--json'), { env, homeDir, stdout, stderr, fetchImpl, whisperModel });
    const voiceHome = resolveVoiceHome({ env, homeDir });
    const json = rest.includes('--json');
    if (verb === 'status') {
        const result = await inspectVoiceEngine({ voiceHome, platform, arch });
        stdout.write(`${json ? JSON.stringify(result) : `${result.state}: ${result.needs.join(toolsText('tools.voice.cli.listSeparator')) || toolsText('tools.voice.cli.alreadyReady')}`}\n`);
        return result.state === 'ready' ? 0 : 1;
    }
    let lastStep = -1;
    const result = await installVoiceEngine({ voiceHome, platform, arch, fetchImpl, statfs, pins, onProgress: progress => {
        const step = Math.min(10, Math.floor(progress.downloadedBytes / progress.totalBytes * 10));
        if (step > lastStep) { lastStep = step; stderr.write(`${progress.phase} ${step * 10}%\n`); }
    } });
    const ok = result.outcome === 'installed' || result.outcome === 'unchanged';
    stdout.write(`${json ? JSON.stringify({ ok, outcome: result.outcome, message: result.message, voiceHome, fetched: result.fetched }) : result.message}\n`);
    return ok ? 0 : 1;
}

async function runWhisperCli(verb, json, { env, homeDir, stdout, stderr, fetchImpl, whisperModel }) {
    if (verb === 'status') {
        const model = whisperModelCandidates({ env, homeDir, repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), bin: '' })
            .find(candidate => existsSync(candidate) && !isWhisperModelExcluded(candidate));
        stdout.write(`${json ? JSON.stringify({ state: model ? 'ready' : 'missing', model: model ?? null }) : model ? toolsText('tools.whisper.cli.statusReady', { path: model }) : toolsText('tools.whisper.cli.statusMissing')}\n`);
        return model ? 0 : 1;
    }
    let lastStep = -1;
    const result = await installWhisperModel({ homeDir, fetchImpl, model: whisperModel, onProgress: ({ downloadedBytes, totalBytes }) => {
        if (!totalBytes) return;
        const step = Math.min(10, Math.floor(downloadedBytes / totalBytes * 10));
        if (step > lastStep) { lastStep = step; stderr.write(`${toolsText('tools.whisper.cli.downloading')} ${step * 10}%\n`); }
    } });
    const ok = result.outcome === 'installed' || result.outcome === 'unchanged';
    stdout.write(`${json ? JSON.stringify({ ok, outcome: result.outcome, message: result.message, path: result.path }) : result.message}\n`);
    return ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
    runToolsCli(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
}
