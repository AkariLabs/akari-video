import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { BALANCE_REQUESTS, OPENROUTER_KEY_URL, balanceRequestUrl, describeBalanceResponse } =
    require('../../lib/node/akari-connections-service.js');
const { AkariConnectionsServiceImpl } = require('../../lib/node/akari-connections-service.js');

test('OpenRouter の Management key は口座残高とキー上限を区別する', () => {
    assert.equal(BALANCE_REQUESTS.openrouter.url, 'https://openrouter.ai/api/v1/credits');
    assert.equal(OPENROUTER_KEY_URL, 'https://openrouter.ai/api/v1/key');
    assert.deepEqual(describeBalanceResponse('openrouter', 200, { data: { total_credits: 10, total_usage: 3.25 } },
        { status: 200, body: { data: { limit_remaining: 2.5 } } }),
    { ok: true, display: '口座の残高 残り $6.75 · キーの上限 残り $2.50' });
    assert.deepEqual(describeBalanceResponse('openrouter', 200, { data: { total_credits: 10, total_usage: 3.25 } },
        { status: 403, body: {} }), { ok: true, display: '口座の残高 残り $6.75' });
});

test('OpenRouter の通常キーは /credits 403 から /key へ切り替え、管理画面を案内する', () => {
    assert.deepEqual(describeBalanceResponse('openrouter', 403, {},
        { status: 200, body: { data: { limit_remaining: 4.7234, usage: 1 } } }),
    { ok: true, display: 'キーの上限 残り $4.72', account_url: 'https://openrouter.ai/settings/credits' });
    assert.deepEqual(describeBalanceResponse('openrouter', 403, {},
        { status: 200, body: { data: { limit_remaining: null, usage: 12.5 } } }),
    { ok: true, display: 'キーの上限なし · 使用 $12.50', account_url: 'https://openrouter.ai/settings/credits' });
});

test('どちらも失敗または応答が壊れたときは金額を出さない', () => {
    for (const result of [
        describeBalanceResponse('openrouter', 403, {}, { status: 403, body: {} }),
        describeBalanceResponse('openrouter', 403, {}, { status: 200, body: { data: { limit_remaining: '7' } } }),
        describeBalanceResponse('openrouter', 200, { data: { total_credits: '10', total_usage: 3 } }),
        describeBalanceResponse('openrouter', 500, {})
    ]) {
        assert.equal(result.ok, false);
        assert.equal(result.display, undefined);
        assert.doesNotMatch(result.error, /\$\d/);
    }
});

test('fal は口座、ElevenLabs は今月の残りを明記する', () => {
    assert.deepEqual(describeBalanceResponse('fal', 200, { credits: { current_balance: 18.4, currency: 'USD' } }),
        { ok: true, display: '口座のクレジット 残り $18.40' });
    assert.deepEqual(describeBalanceResponse('elevenlabs', 200, { character_limit: 100000, character_count: 12345 }),
        { ok: true, display: '今月の残り 87,655 クレジット' });
});

test('模擬サーバーへの向け替えは両方の OpenRouter エンドポイントで効く', () => {
    const env = { AKARI_BALANCE_API_ORIGIN: 'http://127.0.0.1:9458' };
    assert.equal(balanceRequestUrl(BALANCE_REQUESTS.openrouter.url, env), 'http://127.0.0.1:9458/api/v1/credits');
    assert.equal(balanceRequestUrl(OPENROUTER_KEY_URL, env), 'http://127.0.0.1:9458/api/v1/key');
});

test('模擬サーバーで /credits → /key の実際の GET 順序と結果を確かめる', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'akari-balance-test-'));
    const previous = { origin: process.env.AKARI_BALANCE_API_ORIGIN, credentials: process.env.AKARI_CREDENTIALS_FILE };
    const credentials = join(temporary, 'credentials.env');
    writeFileSync(credentials, 'OPENROUTER_API_KEY=test-key\n', { mode: 0o600 });
    const calls = [];
    let creditsStatus = 200;
    let keyStatus = 200;
    let keyLimit = 2.5;
    const server = createServer((request, response) => {
        calls.push(request.url);
        const credits = request.url === '/api/v1/credits';
        response.writeHead(credits ? creditsStatus : keyStatus, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(credits ? { data: { total_credits: 10, total_usage: 3.25 } }
            : { data: { limit_remaining: keyLimit, usage: 7.5 } }));
    });
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        process.env.AKARI_BALANCE_API_ORIGIN = `http://127.0.0.1:${server.address().port}`;
        process.env.AKARI_CREDENTIALS_FILE = credentials;
        const service = new AkariConnectionsServiceImpl();
        service.registry = async () => ({ providers: [{ id: 'openrouter', auth: 'env-key', env: '${OPENROUTER_API_KEY}' }] });
        const account = await service.readBalance('openrouter');
        assert.equal(account.display, '口座の残高 残り $6.75 · キーの上限 残り $2.50');
        assert.deepEqual(calls.splice(0), ['/api/v1/credits', '/api/v1/key']);

        creditsStatus = 403;
        keyLimit = null;
        const key = await service.readBalance('openrouter');
        assert.equal(key.display, 'キーの上限なし · 使用 $7.50');
        assert.equal(key.account_url, 'https://openrouter.ai/settings/credits');
        assert.deepEqual(calls.splice(0), ['/api/v1/credits', '/api/v1/key']);

        keyStatus = 403;
        const failed = await service.readBalance('openrouter');
        assert.equal(failed.ok, false);
        assert.equal(failed.display, undefined);
        assert.deepEqual(calls.splice(0), ['/api/v1/credits', '/api/v1/key']);
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (previous.origin === undefined) delete process.env.AKARI_BALANCE_API_ORIGIN;
        else process.env.AKARI_BALANCE_API_ORIGIN = previous.origin;
        if (previous.credentials === undefined) delete process.env.AKARI_CREDENTIALS_FILE;
        else process.env.AKARI_CREDENTIALS_FILE = previous.credentials;
        rmSync(temporary, { recursive: true, force: true });
    }
});

test('同梱アイコンは元 PNG と同一で、配布時の cwd に依存しない', () => {
    const { AKARI_APP_ICON } = require('../../lib/browser/settings/app-icon.js');
    const original = readFileSync(new URL('../../../../resources/icons/icon-512.png', import.meta.url));
    assert.deepEqual(Buffer.from(AKARI_APP_ICON.replace(/^data:image\/png;base64,/, ''), 'base64'), original);
});
