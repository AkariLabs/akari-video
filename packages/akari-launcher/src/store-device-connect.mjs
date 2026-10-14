import { spawnSync } from 'node:child_process';
import { cliText } from './i18n.mjs';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { DEFAULT_STORE_BASE_URL, normalizeAkariUrl } from './service-urls.cjs';
export { DEFAULT_STORE_BASE_URL } from './service-urls.cjs';
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
    return { ...parsed, url: normalizeAkariUrl(parsed.url) };
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
    response = await fetchImpl(`${normalizeAkariUrl(baseUrl).replace(/\/+$/, '')}/v1/entitlements`, {
      headers: { authorization: `Bearer ${token}` }
    });
  } catch (error) {
    return { error: cliText('cli.store.error.labConnection', { message: error instanceof Error ? error.message : String(error) }) };
  }
  if (response.status === 401) return { error: cliText('cli.store.error.invalidToken') };
  if (!response.ok) return { error: cliText('cli.store.error.labResponse', { status: response.status }) };
  return { data: await response.json() };
}

export function formatStoreEntitlements(data, log) {
  if (data.entitlements.length === 0) {
    log(cliText('cli.store.purchases.empty'));
    return;
  }
  log(cliText('cli.store.purchases.heading'));
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
    const error = cliText('cli.store.error.tokenFormat');
    log(error);
    return { status: 'error', error };
  }
  const { data, error } = await fetchStoreEntitlements(fetchImpl, baseUrl, token);
  if (error) {
    log(error);
    return { status: 'error', error };
  }
  const credentials = {
    url: normalizeAkariUrl(baseUrl),
    token,
    email: data.email,
    connected_at: now().toISOString()
  };
  writeCredentials(env, credentials);
  log(cliText('cli.store.connect.complete', { email: data.email }));
  formatStoreEntitlements(data, log);
  log(cliText('cli.store.connect.installGuide'));
  return { status: 'approved', credentials, entitlements: data.entitlements };
}

export async function startDeviceConnection({
  fetchImpl = fetch,
  baseUrl = DEFAULT_STORE_BASE_URL,
  label = `AKARI Video (${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'})`,
  openBrowser
} = {}) {
  const normalizedBaseUrl = normalizeAkariUrl(baseUrl).replace(/\/+$/, '');
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
      error: cliText('cli.store.error.labConnection', { message: error instanceof Error ? error.message : String(error) })
    };
  }
  if (!response.ok) {
    return { status: 'error', error: cliText('cli.store.error.labStatus', { status: response.status }) };
  }
  const body = await response.json().catch(() => ({}));
  if (typeof body.device_code !== 'string' || typeof body.user_code !== 'string'
    || typeof body.verification_url !== 'string') {
    return { status: 'error', error: cliText('cli.store.error.labPayload') };
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
    response = await fetchImpl(`${normalizeAkariUrl(baseUrl).replace(/\/+$/, '')}/device/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode })
    });
  } catch (error) {
    return {
      status: 'network-error',
      error: cliText('cli.store.error.labConnection', { message: error instanceof Error ? error.message : String(error) })
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
