const fs = require('node:fs');
const original = globalThis.fetch;
if (typeof original === 'function' && process.env.AKARI_GEMINI_NETWORK_LOG) {
  fs.appendFileSync(process.env.AKARI_GEMINI_NETWORK_LOG, JSON.stringify({ kind: 'installed', pid: process.pid }) + '\n');
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/voices(?:\?|$)/.test(url ?? '')) {
      fs.appendFileSync(process.env.AKARI_GEMINI_NETWORK_LOG, JSON.stringify({ kind: 'blocked-post', pid: process.pid, method, url }) + '\n');
      throw new Error('L1 guard blocked POST /v1beta/voices');
    }
    return original.call(this, input, init);
  };
}
