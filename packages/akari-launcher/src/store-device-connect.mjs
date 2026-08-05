import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';

export const DEFAULT_STORE_BASE_URL = 'https://akari-oss.app/api/store';
const CREDENTIALS_FILE = 'store-credentials.json';

export function resolveAkariHome(env = process.env) {
  return env.AKARI_HOME || path.join(homedir(), '.akari');
}

export function resolveCredentialsPath(env = process.env) {
  return path.join(resolveAkariHome(env), CREDENTIALS_FILE);
}

export function readCredentials(env = process.env) {
  const file = resolveCredentialsPath(env);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed?.token !== 'string' || typeof parsed?.url !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCredentials(env, credentials) {
  const file = resolveCredentialsPath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`);
  chmodSync(file, 0o600);
}

export function removeCredentials(env = process.env) {
  const file = resolveCredentialsPath(env);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

export function defaultOpenBrowser(url, platform = process.platform) {
  const cmd = platform === 'darwin' ? ['open', url]
    : platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  try {
    const result = spawnSync(cmd[0], cmd.slice(1), { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export async function fetchStoreEntitlements(fetchImpl, baseUrl, token) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/entitlements`, {
      headers: { authorization: `Bearer ${token}` }
    });
  } catch (error) {
    return { error: `ストアに接続できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (response.status === 401) return { error: 'トークンが無効です。マイページで発行し直してください。' };
  if (!response.ok) return { error: `ストアがエラーを返しました（${response.status}）` };
  return { data: await response.json() };
}

export function formatStoreEntitlements(data, log) {
  if (data.entitlements.length === 0) {
    log('購入済みの商品はまだありません。');
    return;
  }
  log('購入済みの商品:');
  for (const entitlement of data.entitlements) {
    log(`  - ${entitlement.product_id}（v${entitlement.current_version}）`);
  }
}

export async function validateAndSaveCredentials(
  { fetchImpl = fetch, env = process.env, log = () => undefined, now = () => new Date() },
  baseUrl,
  token
) {
  if (!/^akst_[A-Za-z0-9_-]+$/.test(token)) {
    const error = 'トークンの形式が正しくありません（akst_ で始まる文字列です）。';
    log(error);
    return { status: 'error', error };
  }
  const { data, error } = await fetchStoreEntitlements(fetchImpl, baseUrl, token);
  if (error) {
    log(error);
    return { status: 'error', error };
  }
  const credentials = {
    url: baseUrl,
    token,
    email: data.email,
    connected_at: now().toISOString()
  };
  writeCredentials(env, credentials);
  log(`接続しました: ${data.email}`);
  formatStoreEntitlements(data, log);
  log('セッション内で「購入した素材をセットアップして」と頼むと展開まで進みます。');
  return { status: 'approved', credentials, entitlements: data.entitlements };
}

export async function startDeviceConnection({
  fetchImpl = fetch,
  baseUrl = DEFAULT_STORE_BASE_URL,
  label = `AKARI Video (${hostname()})`,
  openBrowser
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  let response;
  try {
    response = await fetchImpl(`${normalizedBaseUrl}/device/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label })
    });
  } catch (error) {
    return {
      status: 'network-error',
      error: `ストアに接続できませんでした: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (!response.ok) {
    return { status: 'error', error: `ストアに接続できませんでした（${response.status}）` };
  }
  const body = await response.json().catch(() => ({}));
  if (typeof body.device_code !== 'string' || typeof body.user_code !== 'string'
    || typeof body.verification_url !== 'string') {
    return { status: 'error', error: 'ストアから接続に必要な情報を受け取れませんでした。' };
  }
  const result = {
    status: 'started',
    baseUrl: normalizedBaseUrl,
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUrl: body.verification_url,
    intervalMs: Math.max(1, body.interval ?? 3) * 1000,
    expiresAt: Date.now() + (body.expires_in ?? 600) * 1000
  };
  if (openBrowser) {
    openBrowser(result.verificationUrl);
  }
  return result;
}

export async function pollDeviceConnection({
  fetchImpl = fetch,
  env = process.env,
  log = () => undefined,
  baseUrl,
  deviceCode
}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/device/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode })
    });
  } catch (error) {
    return {
      status: 'network-error',
      error: `ストアに接続できませんでした: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (response.status === 410) {
    return { status: 'expired' };
  }
  const body = await response.json().catch(() => ({}));
  if (body.status === 'expired') {
    return { status: 'expired' };
  }
  if (body.status !== 'approved' || typeof body.token !== 'string') {
    return { status: 'pending' };
  }
  return validateAndSaveCredentials({ fetchImpl, env, log }, baseUrl, body.token);
}
