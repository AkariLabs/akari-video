import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { getH264Proxy } from '../lib/node/hevc-proxy.js';

const here = dirname(fileURLToPath(import.meta.url));
const handlerSource = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

const commandExists = command => {
    try {
        execFileSync(command, ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

const hasMediaTools = commandExists('ffmpeg') && commandExists('ffprobe');

const probeVideo = path => JSON.parse(execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=pix_fmt,profile',
    '-of', 'json',
    path
], { encoding: 'utf8' })).streams?.[0];

const extractHostFallbackMethod = () => {
    const startMarker = '    protected async handleHevcFallbackRequest(';
    const endMarker = '\n    protected isOpenOutputRequest';
    const start = handlerSource.indexOf(startMarker);
    const end = handlerSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
    return handlerSource.slice(start, end);
};

test('two 10-bit HEVC sources both pass the host gate and produce 8-bit H.264 proxies', {
    skip: !hasMediaTools && 'ffmpeg/ffprobe are required'
}, async t => {
    const methodSource = extractHostFallbackMethod();
    const declaredGate = methodSource.indexOf('widget.akariPreviewFallbackSourceUris?.has(request.videoUri)');
    const attemptedGate = methodSource.indexOf('this.hevcFallbackAttempted.has(key)');
    const attemptedAdd = methodSource.indexOf('this.hevcFallbackAttempted.add(key)');
    const resolveCall = methodSource.indexOf('this.previewService.resolveHevcProxy({');
    assert.ok(declaredGate >= 0);
    assert.ok(declaredGate < attemptedGate);
    assert.ok(attemptedGate < attemptedAdd);
    assert.ok(attemptedAdd < resolveCall);

    const root = mkdtempSync(join(tmpdir(), 'akari-preview-hevc-two-source-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const sourcePaths = [join(root, 'take-a.mp4'), join(root, 'take-b.mp4')];
    const filters = ['testsrc2=s=64x64:r=10:d=0.6', 'smptebars=s=64x64:r=10:d=0.6'];
    for (let index = 0; index < sourcePaths.length; index += 1) {
        execFileSync('ffmpeg', [
            '-v', 'error',
            '-f', 'lavfi',
            '-i', filters[index],
            '-c:v', 'libx265',
            '-x265-params', 'log-level=error',
            '-pix_fmt', 'yuv420p10le',
            '-tag:v', 'hvc1',
            sourcePaths[index]
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        assert.equal(probeVideo(sourcePaths[index])?.pix_fmt, 'yuv420p10le');
    }

    const sourceByUri = new Map(sourcePaths.map(path => [pathToFileURL(path).href, path]));
    const declaredSourceUris = new Set(sourceByUri.keys());
    const attempted = new Set();
    const hostArrivals = [];
    const resolveCalls = [];
    const gateTrace = [];
    const simulateHostFallback = async requestVideoUri => {
        hostArrivals.push(requestVideoUri);
        gateTrace.push(`${basename(sourceByUri.get(requestVideoUri) ?? requestVideoUri)}:declared`);
        if (!declaredSourceUris.has(requestVideoUri)) return { ok: false, error: 'undeclared' };
        const key = requestVideoUri;
        gateTrace.push(`${basename(sourceByUri.get(key))}:attempted`);
        if (attempted.has(key)) return { ok: false, error: 'attempted' };
        attempted.add(key);
        gateTrace.push(`${basename(sourceByUri.get(key))}:resolve`);
        resolveCalls.push(key);
        const result = await getH264Proxy(root, sourceByUri.get(key));
        return result.status === 'ready' ? { ok: true, result } : { ok: false, error: result.status };
    };

    const requestUris = [...declaredSourceUris];
    const results = [];
    for (const requestUri of requestUris) results.push(await simulateHostFallback(requestUri));

    assert.deepEqual(hostArrivals, requestUris);
    assert.deepEqual(resolveCalls, requestUris);
    assert.deepEqual(gateTrace, [
        'take-a.mp4:declared', 'take-a.mp4:attempted', 'take-a.mp4:resolve',
        'take-b.mp4:declared', 'take-b.mp4:attempted', 'take-b.mp4:resolve'
    ]);
    for (const result of results) {
        assert.equal(result.ok, true);
        assert.equal(result.result.status, 'ready');
        const proxyProbe = probeVideo(result.result.proxyPath);
        assert.equal(proxyProbe?.pix_fmt, 'yuv420p');
        assert.doesNotMatch(proxyProbe?.profile ?? '', /High 10/u);
    }

    assert.deepEqual(await simulateHostFallback(requestUris[0]), { ok: false, error: 'attempted' });
    assert.equal(resolveCalls.length, 2);
});
