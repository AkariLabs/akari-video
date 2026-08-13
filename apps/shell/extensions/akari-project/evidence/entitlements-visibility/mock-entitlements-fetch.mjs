import { appendFile } from 'node:fs/promises';

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://entitlements.invalid/api/store/v1/entitlements') {
    if (process.env.AKARI_L1_MOCK_REQUEST_LOG) {
      await appendFile(process.env.AKARI_L1_MOCK_REQUEST_LOG, `${JSON.stringify({
        url,
        authorization: init?.headers?.authorization ?? null
      })}\n`);
    }
    const revoked = process.env.AKARI_L1_ENTITLEMENTS_SCENARIO === 'revoked';
    return new Response(JSON.stringify(revoked
      ? { error: 'token_revoked' }
      : { error: 'mock_network_error' }), {
      status: revoked ? 401 : 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  return originalFetch(input, init);
};
