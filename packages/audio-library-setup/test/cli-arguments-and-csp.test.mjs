import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createGalleryServer } from '../gallery-server.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runBin(name, args) {
    return spawnSync(process.execPath, [path.join(packageRoot, 'bin', `${name}.mjs`), ...args], {
        cwd: packageRoot,
        env: { ...process.env, AKARI_FFMPEG_BIN: '/nonexistent/ffmpeg', AKARI_FFPROBE_BIN: '/nonexistent/ffprobe' },
        encoding: 'utf8',
    });
}

test('gallery page CSP permits its inline script, same-origin API, and audio', async () => {
    const libraryRoot = await mkdtemp(path.join(tmpdir(), 'akari-gallery-csp-'));
    const server = createGalleryServer(libraryRoot);
    try {
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
        assert.equal(response.status, 200);
        assert.equal(
            response.headers.get('content-security-policy'),
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(libraryRoot, { recursive: true, force: true });
    }
});

for (const [name, option] of [
    ['beat-grid', '--snap'],
    ['register-drop-folder', '--drop-dir'],
    ['suggest-bgm', '--tone'],
]) {
    test(`${name} reports a missing ${option} value without a stack trace`, () => {
        for (const args of [[option], [option, '--json']]) {
            const result = runBin(name, args);
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stderr, new RegExp(`${option} には値が必要です`));
            assert.match(result.stderr, /（例: /);
            assert.doesNotMatch(result.stderr, /\b(?:TypeError|Error:)\b|\n\s+at /);
        }
    });
}

for (const name of ['register-drop-folder', 'generate-candidates-html', 'gallery-helper', 'declare-helper']) {
    test(`${name} prints usage for --help and -h before parsing other options`, () => {
        for (const flag of ['--help', '-h']) {
            const result = runBin(name, ['--unknown', flag]);
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, new RegExp(`Usage: node bin/${name}\\.mjs`));
            assert.match(result.stdout, /--help/);
            assert.equal(result.stderr, '');
        }
    });
}
