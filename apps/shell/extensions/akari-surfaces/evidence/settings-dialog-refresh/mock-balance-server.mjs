// L1 用の残高の模擬サーバー（実キーでの問い合わせは不要 — 契約の受け入れ条件）。
//   MOCK_PORT=9458 MOCK_LOG=<ログファイル> node mock-balance-server.mjs
// シェルは AKARI_BALANCE_API_ORIGIN=http://127.0.0.1:9458 のときだけここへ向く（ループバック限定）。
// 各社の公式ドキュメントにある応答の形をそのまま返し、受けたリクエスト（パス・認証ヘッダの種類）を記録する。
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 9458);
const LOG = process.env.MOCK_LOG;
const log = entry => { if (LOG) { appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } };

createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    const auth = request.headers.authorization?.split(' ')[0] ?? (request.headers['xi-api-key'] ? 'xi-api-key' : null);
    log({ method: request.method, path: url.pathname + url.search, auth });
    const send = (status, body) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
    };
    // https://openrouter.ai/docs/api_reference/limits
    if (url.pathname === '/api/v1/key' && auth === 'Bearer') {
        return send(200, { data: { label: 'sk-or-v1-l1…', limit: 10, limit_remaining: 4.72, usage: 5.28, is_free_tier: false } });
    }
    // https://fal.ai/docs/platform-apis/v1/account/billing
    if (url.pathname === '/v1/account/billing' && url.searchParams.get('expand') === 'credits' && auth === 'Key') {
        return send(200, { username: 'l1-team', credits: { current_balance: 18.4, currency: 'USD' } });
    }
    // https://elevenlabs.io/docs/api-reference/user/subscription/get
    if (url.pathname === '/v1/user/subscription' && auth === 'xi-api-key') {
        return send(200, { tier: 'creator', character_count: 12345, character_limit: 100000 });
    }
    return send(404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`mock balance server on ${PORT}`));
