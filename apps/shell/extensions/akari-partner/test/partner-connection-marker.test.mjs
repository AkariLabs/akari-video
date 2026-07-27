import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPartnerConnectionMarker } from '../lib/common/partner-connection-marker.js';
import {
    resolveAkariHomeDir,
    resolvePartnerConnectionMarkerPath,
    writePartnerConnectionMarker
} from '../lib/node/partner-connection-writer.js';

// アプリ単位マーカー（~/.akari/partner-connection.json）。ホームディレクトリを
// 汚さないよう、書き込みを伴うテストは必ず mkdtemp + AKARI_HOME で隔離する。

const NOW = '2026-07-27T04:05:06.000Z';

test('buildPartnerConnectionMarker: 契約どおりの形と値', () => {
    const marker = buildPartnerConnectionMarker('claude', '/opt/akari/bin/claude', NOW);
    assert.deepEqual(marker, {
        schema: 1,
        status: 'ok',
        agent: 'claude',
        executablePath: '/opt/akari/bin/claude',
        connected_at: NOW
    });
    assert.deepEqual(Object.keys(marker), ['schema', 'status', 'agent', 'executablePath', 'connected_at']);
});

test('buildPartnerConnectionMarker: agent は接続したパートナーをそのまま持つ', () => {
    assert.equal(buildPartnerConnectionMarker('codex', '/x/codex', NOW).agent, 'codex');
});

test('resolveAkariHomeDir: AKARI_HOME があればそれ自体が AKARI ホーム', () => {
    assert.equal(resolveAkariHomeDir({ AKARI_HOME: '/tmp/akari-home' }, '/Users/example'), '/tmp/akari-home');
});

test('resolveAkariHomeDir: 未設定ならホームディレクトリ配下の .akari', () => {
    assert.equal(resolveAkariHomeDir({}, '/Users/example'), path.join('/Users/example', '.akari'));
});

test('resolvePartnerConnectionMarkerPath: update-check.json と同じ場所に置く', () => {
    assert.equal(
        resolvePartnerConnectionMarkerPath({ AKARI_HOME: '/tmp/akari-home' }, '/Users/example'),
        path.join('/tmp/akari-home', 'partner-connection.json')
    );
    assert.equal(
        resolvePartnerConnectionMarkerPath({}, '/Users/example'),
        path.join('/Users/example', '.akari', 'partner-connection.json')
    );
});

test('writePartnerConnectionMarker: 親ディレクトリごと作り、読み返せる JSON を書く', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'akari-home-'));
    // まだ存在しない AKARI_HOME を指しても書けること（初回接続の実態）。
    const akariHome = path.join(home, 'nested', '.akari');
    const target = resolvePartnerConnectionMarkerPath({ AKARI_HOME: akariHome }, home);
    const marker = buildPartnerConnectionMarker('claude', '/opt/akari/bin/claude', NOW);

    await writePartnerConnectionMarker(marker, target);

    assert.ok((await stat(target)).isFile());
    const raw = await readFile(target, 'utf8');
    assert.ok(raw.endsWith('}\n'));
    assert.deepEqual(JSON.parse(raw), marker);
    // ホームゲート側の判定条件（status === 'ok'）をこのファイルが満たす。
    assert.equal(JSON.parse(raw).status, 'ok');
});

test('writePartnerConnectionMarker: 再接続時は上書きする', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'akari-home-'));
    const target = resolvePartnerConnectionMarkerPath({ AKARI_HOME: home }, home);
    await writePartnerConnectionMarker(buildPartnerConnectionMarker('claude', '/a/claude', NOW), target);
    await writePartnerConnectionMarker(buildPartnerConnectionMarker('codex', '/b/codex', '2026-07-28T00:00:00.000Z'), target);
    const parsed = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(parsed.agent, 'codex');
    assert.equal(parsed.executablePath, '/b/codex');
    assert.equal(parsed.connected_at, '2026-07-28T00:00:00.000Z');
});
