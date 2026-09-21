import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_JUDGE_URL = 'http://127.0.0.1:4748';
export const SERVE_JUDGE_URL = 'https://akari.video/api/vibe';
const STATUS_MESSAGE = new Map([
    [401, 'Lab に接続してください'],
    [402, 'Lab に接続してください'],
    [429, '今日の上限に達しました'],
]);
const PROVIDER_KEY_REQUIRED_MESSAGE = 'OpenRouter の API キーを設定してください（~/.config/akari/openrouter.env）';
const PROVIDER_KEY_REJECTED_MESSAGE = 'OpenRouter の API キーが拒否されました（キーと残高を確認してください）';

function isLocalHostname(hostname) {
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function endpoint(value, allowInsecureTransport) {
    const url = new URL(value);
    const local = isLocalHostname(url.hostname);
    const inProcessTest = allowInsecureTransport && url.hostname === 'in-process.test';
    if (!local && !inProcessTest && url.protocol !== 'https:') throw new Error('ローカル以外の判断先には https が必要です');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('判断先 URL が不正です');
    }
    return url.href.replace(/\/$/, '');
}

function redactSecret(value, ...secrets) {
    const present = secrets.filter(secret => typeof secret === 'string' && secret);
    if (typeof value === 'string') {
        return present.reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), value);
    }
    if (Array.isArray(value)) return value.map(item => redactSecret(item, ...present));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        redactSecret(key, ...present),
        redactSecret(child, ...present),
    ]));
}

function storedToken({ env, home, readFile }) {
    try {
        const value = JSON.parse(readFile(path.join(env.AKARI_HOME || path.join(home, '.akari'), 'store-credentials.json'), 'utf8'))?.token;
        return typeof value === 'string' && value ? value : null;
    } catch {
        return null;
    }
}

function providerKeyValue(value) {
    if (typeof value !== 'string') return null;
    let key = value.trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1).trim();
    }
    return key || null;
}

function storedProviderKey({ env, home, readFile }) {
    for (const file of [env.AKARI_CREDENTIALS_FILE,
        path.join(home, '.config/akari-video/credentials.env'),
        path.join(home, '.config/akari/openrouter.env')].filter(Boolean)) {
        try {
            for (const line of readFile(file, 'utf8').split(/\r?\n/)) {
                const match = line.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.*?)\s*$/);
                const key = match && providerKeyValue(match[1]);
                if (key) return key;
            }
        } catch { /* Missing or unreadable credentials mean unset. */ }
    }
    return null;
}

// Only presence leaves this module. Re-read files so settings take effect immediately.
export function credentialStatus({ env = process.env, home = os.homedir(), readFile = fs.readFileSync } = {}) {
    return {
        lab: env.AKARI_VOICE_JUDGE_TOKEN || storedToken({ env, home, readFile }) ? 'connected' : 'missing',
        providerKey: providerKeyValue(env.OPENROUTER_API_KEY) || storedProviderKey({ env, home, readFile }) ? 'set' : 'missing',
    };
}

async function statusMessage(response) {
    if (response.status !== 402) return STATUS_MESSAGE.get(response.status);
    try {
        const error = (await response.json())?.error;
        if (error === 'provider_key_required') return PROVIDER_KEY_REQUIRED_MESSAGE;
        if (error === 'provider_key_rejected') return PROVIDER_KEY_REJECTED_MESSAGE;
    } catch {
        // 従来の 402 と同じ案内へフォールバックする。
    }
    return STATUS_MESSAGE.get(402);
}

export function createJudgeClient({
    env = process.env,
    fetch: fetchImpl = globalThis.fetch,
    home = os.homedir(),
    readFile = fs.readFileSync,
    onUserMessage = () => {},
    allowInsecureTransport = false,
    serve = false,
} = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
    const baseUrl = endpoint(env.AKARI_VOICE_JUDGE_URL ?? (serve ? SERVE_JUDGE_URL : DEFAULT_JUDGE_URL), allowInsecureTransport);
    // Lab の接続の鍵は Lab（https の宛先）にだけ送る。手元の判断のサーバー（127.0.0.1 / localhost）へは、
    // 明示の AKARI_VOICE_JUDGE_TOKEN があるときだけ。誰が手元のポートで待っているか分からない相手へ鍵を渡さない。
    const target = new URL(baseUrl);
    const local = isLocalHostname(target.hostname);
    // 保存してある 2 つの鍵（Lab の接続の鍵・利用者の OpenRouter の鍵）を送ってよい相手は、既定では AKARI Video Lab だけ。
    // 宛先の打ち間違いで第三者のホストへ鍵を送らない。ほかの https の宛先へ送るのは AKARI_VOICE_JUDGE_TRUST_HOST=1 の明示があるときだけ。
    const trustedHost = target.hostname === 'akari.video' || env.AKARI_VOICE_JUDGE_TRUST_HOST === '1';
    const remote = target.protocol === 'https:' && !local;
    if (remote && !trustedHost) throw new Error('判断 API の宛先が akari.video ではありません（ほかの宛先へ鍵を送るには AKARI_VOICE_JUDGE_TRUST_HOST=1）');
    const sendsProviderKey = remote;
    return Object.freeze({
        baseUrl,
        async judge(request, { signal } = {}) {
            const token = env.AKARI_VOICE_JUDGE_TOKEN || (local ? null : storedToken({ env, home, readFile }));
            const providerKey = sendsProviderKey
                ? providerKeyValue(env.OPENROUTER_API_KEY) || storedProviderKey({ env, home, readFile }) : null;
            if (sendsProviderKey && !providerKey) {
                onUserMessage(PROVIDER_KEY_REQUIRED_MESSAGE);
                throw new Error(PROVIDER_KEY_REQUIRED_MESSAGE);
            }
            let response;
            try {
                response = await fetchImpl(`${baseUrl}/judge`, {
                    method: 'POST', signal, redirect: 'error',
                    headers: {
                        'Content-Type':'application/json',
                        ...(token ? { Authorization:`Bearer ${token}` } : {}),
                        ...(providerKey ? { 'x-akari-provider-key':providerKey } : {}),
                    },
                    body: JSON.stringify(request),
                });
            } catch {
                throw new Error('判断 API に接続できませんでした');
            }
            const userMessage = await statusMessage(response);
            if (userMessage) {
                onUserMessage(userMessage);
                throw new Error(userMessage);
            }
            if (!response.ok) throw new Error(`判断 API が応答しませんでした（HTTP ${response.status}）`);
            try {
                return redactSecret(await response.json(), token, providerKey);
            } catch {
                throw new Error('判断 API の応答を読み取れませんでした');
            }
        },
    });
}
